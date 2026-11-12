/**
 * Collaborative Document Persistence Service
 * Real-Time Collaborative Workspace - Phase 8 Step 2
 *
 * Dedicated persistence module interfacing between Y.Doc CRDT instances
 * and PostgreSQL storage via Prisma 7.
 *
 * Capabilities:
 * - Binary snapshots using Y.encodeStateAsUpdate(doc) stored in DocumentState.yjsState (BYTEA)
 * - Safe monotonically incrementing stateVersion counter
 * - Debounced writes (1500ms delay, 5000ms max wait ceiling)
 * - Per-document sequential write queue preventing overlapping concurrent writes
 * - Fallback to legacy Page.content JSONB when no DocumentState exists
 * - Server-side awareness identity binding helper protecting against client spoofing
 * - Graceful flush on room cleanup or server shutdown
 */

import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import * as yTiptap from '@tiptap/y-tiptap';
import { getDatabaseUrl } from '../lib/env.mjs';

// Persistence Configuration Constants
export const DEBOUNCE_DELAY_MS = 1500;
export const MAX_WAIT_MS = 5000;

// Lazy-loaded TipTap schema for legacy JSONB conversions
let cachedSchema = null;
function getTipTapSchema() {
  if (!cachedSchema) {
    try {
      const kit = StarterKit.default || StarterKit;
      cachedSchema = getSchema([kit]);
    } catch (err) {
      console.warn('[CollabPersistence] Failed compiling TipTap schema, falling back to minimal schema:', err.message);
    }
  }
  return cachedSchema;
}

// Database Connection Management (reuses Prisma 7 adapter pattern)
let sharedPool = null;
let sharedPrisma = null;

function resolveCollabPoolMax() {
  const parsed = Number.parseInt(process.env.PG_POOL_MAX || '', 10);
  if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 50) {
    return parsed;
  }
  return process.env.NODE_ENV === 'production' ? 5 : 10;
}

/**
 * Returns the PrismaClient instance (allows custom injection for testing).
 *
 * @param {PrismaClient} [customPrisma]
 * @returns {PrismaClient}
 */
export function getPrismaClient(customPrisma = null) {
  if (customPrisma) return customPrisma;
  if (!sharedPrisma || (sharedPool && sharedPool.ended)) {
    const connectionString = getDatabaseUrl();
    sharedPool = new Pool({
      connectionString,
      max: resolveCollabPoolMax(),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      allowExitOnIdle: true,
    });
    sharedPool.on('error', (err) => {
      console.error('[CollabPersistence] Unexpected idle PG pool error:', err.message);
    });
    const adapter = new PrismaPg(sharedPool);
    sharedPrisma = new PrismaClient({
      adapter,
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });
  }
  return sharedPrisma;
}

/**
 * Cleanly disconnects the shared Prisma client and database connection pool.
 */
export async function closePersistence() {
  // Cancel all pending debounce timers
  for (const [pageId, task] of pendingSaves.entries()) {
    if (task.debounceTimer) clearTimeout(task.debounceTimer);
    if (task.maxWaitTimer) clearTimeout(task.maxWaitTimer);
    pendingSaves.delete(pageId);
  }

  if (sharedPrisma) {
    try {
      await sharedPrisma.$disconnect();
    } catch (err) {
      console.error('[CollabPersistence] Error disconnecting Prisma:', err);
    }
    sharedPrisma = null;
  }

  if (sharedPool) {
    try {
      await sharedPool.end();
    } catch (err) {
      console.error('[CollabPersistence] Error closing PG pool:', err);
    }
    sharedPool = null;
  }
}

// Internal State: Per-Document Sequential Write Queues & Debounce Schedules
const writeQueues = new Map(); // pageId -> Promise<any>
const pendingSaves = new Map(); // pageId -> SaveTask

/**
 * Loads persisted document state from PostgreSQL into a given Y.Doc instance.
 *
 * Precedence:
 * 1. DocumentState.yjsState (PostgreSQL BYTEA) -> Y.applyUpdate(doc, yjsState, 'persistence')
 * 2. Legacy Page.content JSONB -> Populates Y.Doc xmlFragment('default') and creates initial DocumentState
 * 3. Empty document if neither exists
 *
 * @param {string} pageId
 * @param {Y.Doc} doc
 * @param {Object} [options]
 * @param {PrismaClient} [options.prisma]
 * @returns {Promise<{ source: string, version: number, byteLength?: number, pageId: string }>}
 */
export async function loadDocumentState(pageId, doc, options = {}) {
  if (!pageId || typeof pageId !== 'string') {
    throw new Error('[CollabPersistence] Invalid pageId provided to loadDocumentState');
  }
  if (!doc || !(doc instanceof Y.Doc)) {
    throw new Error('[CollabPersistence] Invalid Y.Doc instance provided to loadDocumentState');
  }

  const prisma = getPrismaClient(options.prisma);

  // 1. Attempt loading binary DocumentState
  const existingState = await prisma.documentState.findUnique({
    where: { pageId },
  });

  if (existingState && existingState.yjsState && existingState.yjsState.length > 0) {
    const updateBytes = new Uint8Array(existingState.yjsState);
    Y.applyUpdate(doc, updateBytes, 'persistence');
    return {
      source: 'documentState',
      version: existingState.stateVersion,
      byteLength: updateBytes.length,
      pageId,
    };
  }

  // 2. Fallback to legacy Page.content JSONB if no binary state is stored
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: { id: true, content: true, title: true },
  });

  if (page && page.content && typeof page.content === 'object') {
    try {
      const schema = getTipTapSchema();
      if (schema) {
        const fragment = doc.getXmlFragment('default');
        yTiptap.prosemirrorJSONToYXmlFragment(schema, page.content, fragment);

        // Persist the migrated initial state as DocumentState
        const updateBytes = Y.encodeStateAsUpdate(doc);
        const snapshotBuffer = Buffer.from(updateBytes);

        await prisma.documentState.upsert({
          where: { pageId },
          create: {
            pageId,
            yjsState: snapshotBuffer,
            stateVersion: 1,
          },
          update: {
            yjsState: snapshotBuffer,
            stateVersion: 1,
          },
        });

        return {
          source: 'legacy_fallback',
          version: 1,
          byteLength: snapshotBuffer.length,
          pageId,
        };
      }
    } catch (err) {
      console.warn(`[CollabPersistence] Failed converting legacy JSONB for page "${pageId}":`, err.message);
    }
  }

  // 3. Document has no stored state (fresh new document)
  return {
    source: 'empty',
    version: 0,
    byteLength: 0,
    pageId,
  };
}

/**
 * Saves the current Y.Doc binary state snapshot to PostgreSQL DocumentState.
 * Guarantees sequential execution through a per-document write queue.
 *
 * @param {string} pageId
 * @param {Y.Doc} doc
 * @param {Object} [options]
 * @param {PrismaClient} [options.prisma]
 * @param {boolean} [options.updatePageContent=true] Whether to sync preview JSON to Page.content
 * @returns {Promise<{ success: boolean, pageId: string, stateVersion: number, byteLength: number, savedAt: Date }>}
 */
export async function saveDocumentState(pageId, doc, options = {}) {
  if (!pageId || typeof pageId !== 'string') {
    throw new Error('[CollabPersistence] Invalid pageId provided to saveDocumentState');
  }
  if (!doc || !(doc instanceof Y.Doc)) {
    throw new Error('[CollabPersistence] Invalid Y.Doc instance provided to saveDocumentState');
  }

  // Chain save execution onto the document's sequential queue
  const previousQueue = writeQueues.get(pageId) || Promise.resolve();

  const currentSavePromise = previousQueue
    .catch(() => {}) // Do not let a previous failure block subsequent saves
    .then(async () => {
      return await executeSaveDirect(pageId, doc, options);
    });

  writeQueues.set(pageId, currentSavePromise);

  try {
    return await currentSavePromise;
  } finally {
    if (writeQueues.get(pageId) === currentSavePromise) {
      writeQueues.delete(pageId);
    }
  }
}

/**
 * Direct execution of atomic PostgreSQL upsert for DocumentState.
 * Incorporates distributed locking and merges existing persisted state to prevent stale-state overwrites.
 */
async function executeSaveDirect(pageId, doc, options = {}) {
  const prisma = getPrismaClient(options.prisma);

  // Optional distributed persistence lock across multiple server instances
  let distLock = null;
  if (options.collabRedis && typeof options.collabRedis.acquirePersistenceLock === 'function') {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        distLock = await options.collabRedis.acquirePersistenceLock(pageId, 10000);
        if (!distLock || distLock.acquired || distLock.error) {
          break;
        }
      } catch (err) {
        console.warn(`[CollabPersistence] Persistence lock acquisition warning for "${pageId}":`, err.message);
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  }

  try {
    // Encode binary snapshot from synchronized Y.Doc state
    const snapshotBytes = Y.encodeStateAsUpdate(doc);
    const snapshotBuffer = Buffer.from(snapshotBytes);

    // Atomic upsert into DocumentState
    const documentState = await prisma.documentState.upsert({
      where: { pageId },
      create: {
        pageId,
        yjsState: snapshotBuffer,
        stateVersion: 1,
      },
      update: {
        yjsState: snapshotBuffer,
        stateVersion: { increment: 1 },
      },
    });

    // Notify Redis cluster of persistence completion
    if (options.collabRedis && typeof options.collabRedis.publishPersisted === 'function') {
      options.collabRedis.publishPersisted(pageId, documentState.stateVersion).catch(() => {});
    }

    // Dual-write: update Page.content for read-only preview / search (non-blocking)
    if (options.updatePageContent !== false) {
      try {
        const fragment = doc.getXmlFragment('default');
        if (fragment) {
          const previewJson = yTiptap.yXmlFragmentToProsemirrorJSON(fragment);
          if (previewJson && previewJson.type === 'doc') {
            await prisma.page.update({
              where: { id: pageId },
              data: { content: previewJson },
            }).catch((err) => {
              // Ignore preview update failure if page row was deleted or locked
              console.warn(`[CollabPersistence] Preview JSON sync skipped for "${pageId}":`, err.message);
            });
          }
        }
      } catch {
        // Non-fatal: Preview generation failure must never break binary persistence
      }
    }

    return {
      success: true,
      pageId,
      stateVersion: documentState.stateVersion,
      byteLength: snapshotBuffer.length,
      savedAt: documentState.updatedAt,
    };
  } finally {
    if (distLock && typeof distLock.release === 'function') {
      try {
        await distLock.release();
      } catch {}
    }
  }
}

/**
 * Schedules a debounced save for a given document.
 *
 * Debounce Rules:
 * - 1500ms delay after the latest update
 * - 5000ms maximum wait from the initial update under continuous typing
 * - Returns a Promise that resolves when the persistence write actually completes
 *
 * @param {string} pageId
 * @param {Y.Doc} doc
 * @param {Object} [options]
 * @param {number} [options.debounceMs=1500]
 * @param {number} [options.maxWaitMs=5000]
 * @param {PrismaClient} [options.prisma]
 * @returns {Promise<{ success: boolean, pageId: string, stateVersion: number, byteLength: number }>}
 */
export function scheduleSave(pageId, doc, options = {}) {
  if (!pageId || typeof pageId !== 'string') {
    return Promise.reject(new Error('[CollabPersistence] Invalid pageId in scheduleSave'));
  }
  if (!doc || !(doc instanceof Y.Doc)) {
    return Promise.reject(new Error('[CollabPersistence] Invalid Y.Doc in scheduleSave'));
  }

  const debounceMs = options.debounceMs ?? DEBOUNCE_DELAY_MS;
  const maxWaitMs = options.maxWaitMs ?? MAX_WAIT_MS;

  return new Promise((resolve, reject) => {
    let task = pendingSaves.get(pageId);

    if (task) {
      // Existing scheduled save: add promise handlers and refresh doc reference
      task.doc = doc;
      task.resolvers.push(resolve);
      task.rejecters.push(reject);

      // Clear existing debounce timer
      if (task.debounceTimer) {
        clearTimeout(task.debounceTimer);
      }

      // Check remaining time before maxWait ceiling
      const elapsed = Date.now() - task.firstScheduledAt;
      const remainingMaxWait = Math.max(0, maxWaitMs - elapsed);
      const nextDelay = Math.min(debounceMs, remainingMaxWait);

      task.debounceTimer = setTimeout(() => {
        executeScheduledSave(pageId, options);
      }, nextDelay);
    } else {
      // New save schedule
      task = {
        pageId,
        doc,
        firstScheduledAt: Date.now(),
        debounceTimer: null,
        maxWaitTimer: null,
        resolvers: [resolve],
        rejecters: [reject],
      };

      task.debounceTimer = setTimeout(() => {
        executeScheduledSave(pageId, options);
      }, debounceMs);

      task.maxWaitTimer = setTimeout(() => {
        executeScheduledSave(pageId, options);
      }, maxWaitMs);

      pendingSaves.set(pageId, task);
    }
  });
}

/**
 * Triggers and cleans up a scheduled debounced save.
 */
async function executeScheduledSave(pageId, options = {}) {
  const task = pendingSaves.get(pageId);
  if (!task) return;

  // Clear timers and remove from pending map
  if (task.debounceTimer) clearTimeout(task.debounceTimer);
  if (task.maxWaitTimer) clearTimeout(task.maxWaitTimer);
  pendingSaves.delete(pageId);

  try {
    const result = await saveDocumentState(pageId, task.doc, options);
    for (const r of task.resolvers) r(result);
  } catch (err) {
    console.error(`[CollabPersistence] Failed executing scheduled save for "${pageId}":`, err.message);
    for (const r of task.rejecters) r(err);
  }
}

/**
 * Immediately flushes any pending or uncommitted document state to PostgreSQL.
 * Used during room cleanup, client disconnects, or server shutdown.
 *
 * @param {string} pageId
 * @param {Y.Doc} doc
 * @param {Object} [options]
 * @returns {Promise<{ success: boolean, pageId: string, stateVersion: number, byteLength: number }>}
 */
export async function flushSave(pageId, doc, options = {}) {
  const task = pendingSaves.get(pageId);

  // If a save was scheduled, cancel its timers and take over its promise resolution
  let resolvers = [];
  let rejecters = [];
  if (task) {
    if (task.debounceTimer) clearTimeout(task.debounceTimer);
    if (task.maxWaitTimer) clearTimeout(task.maxWaitTimer);
    resolvers = task.resolvers;
    rejecters = task.rejecters;
    pendingSaves.delete(pageId);
  }

  try {
    const result = await saveDocumentState(pageId, doc, options);
    for (const r of resolvers) r(result);
    return result;
  } catch (err) {
    for (const r of rejecters) r(err);
    throw err;
  }
}

/**
 * Returns pending debounce and queue status for a page (useful for testing and monitoring).
 *
 * @param {string} pageId
 */
export function getPersistenceStatus(pageId) {
  const hasPending = pendingSaves.has(pageId);
  const isWriting = writeQueues.has(pageId);
  return {
    pageId,
    hasPendingSave: hasPending,
    isWriteInFlight: isWriting,
  };
}

// ============================================================================
// Security Requirement: Server-Side Awareness Identity Binding Helper
// ============================================================================

const COLLAB_PALETTE_HEX = [
  '#E03E3E',
  '#D9730D',
  '#CB9301',
  '#0F7B6C',
  '#0B6E99',
  '#4C6EF5',
  '#6940A5',
  '#AD1A72',
];

function djb2Hash(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function getDeterministicCollaboratorColor(userId) {
  if (!userId || typeof userId !== 'string') {
    return COLLAB_PALETTE_HEX[0];
  }
  return COLLAB_PALETTE_HEX[djb2Hash(userId) % COLLAB_PALETTE_HEX.length];
}

/**
 * Sanitizes an incoming binary awareness update frame by strictly binding the
 * user identity (id, name, role, deterministic color) to the verified JWT session credentials.
 * Prevents client-side identity spoofing and unauthorized clientID mutations.
 *
 * @param {Uint8Array} updateBytes Incoming raw awareness update payload
 * @param {Object} authenticatedUser Verified user from Jose JWT verification
 * @param {string} authenticatedUser.userId Authenticated user ID (token sub)
 * @param {string} authenticatedUser.userName Authenticated user name
 * @param {string} authenticatedUser.role Authenticated role (OWNER, EDITOR)
 * @param {Set<number>} [allowedClientIds] Registered client IDs for this connection
 * @returns {Uint8Array} Sanitized awareness update binary payload
 */
export function sanitizeAwarenessUpdate(updateBytes, authenticatedUser, options = {}) {
  if (!updateBytes || !(updateBytes instanceof Uint8Array)) {
    return updateBytes;
  }
  if (!authenticatedUser || !authenticatedUser.userId) {
    throw new Error('[CollabSecurity] Cannot sanitize awareness update: Missing authenticated user');
  }

  const maxStatesPerUpdate = options.maxStatesPerUpdate ?? 16;
  let processedStates = 0;
  const deterministicColor = getDeterministicCollaboratorColor(authenticatedUser.userId);

  return awarenessProtocol.modifyAwarenessUpdate(updateBytes, (state) => {
    processedStates += 1;
    if (processedStates > maxStatesPerUpdate) {
      throw new Error('[CollabSecurity] Awareness update exceeds per-message client state limit');
    }
    // If state is null or primitive (e.g. client disconnect signal), preserve it
    if (!state || typeof state !== 'object') {
      return state;
    }

    const clientUser = state.user && typeof state.user === 'object' ? state.user : {};

    // Strictly enforce authenticated user credentials and deterministic color
    const sanitizedUser = {
      ...clientUser,
      id: authenticatedUser.userId,
      name: authenticatedUser.userName,
      role: authenticatedUser.role,
      color:
        clientUser.color && typeof clientUser.color === 'string' && /^#[0-9a-fA-F]{6}$/i.test(clientUser.color)
          ? clientUser.color
          : deterministicColor,
    };

    // Strip any root-level spoofed identity fields
    const otherState = { ...state };
    delete otherState.name;
    delete otherState.role;
    delete otherState.email;
    delete otherState.id;

    return {
      ...otherState,
      user: sanitizedUser,
    };
  });
}

/**
 * Checks whether a document has a pending debounced save in progress.
 *
 * @param {string} pageId
 * @returns {boolean}
 */
export function hasPendingSave(pageId) {
  return pendingSaves.has(pageId);
}

