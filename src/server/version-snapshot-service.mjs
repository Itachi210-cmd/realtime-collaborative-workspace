/**
 * Version History & Document Snapshot Service
 * Real-Time Collaborative Workspace - Phase 10 Step 3
 *
 * Dedicated backend service providing:
 * - Consistent snapshot creation from active or persisted Y.Doc instances
 * - Dual storage of full binary Yjs state (BYTEA) and TipTap JSON preview (JSONB)
 * - Deterministic word count extraction from document AST
 * - Automatic pre-restore recovery snapshot triggers
 * - Newest-first snapshot listing and preview retrieval
 * - Coordination with the persistence write queue to prevent stale snapshots
 */

import * as Y from 'yjs';
import * as yTiptap from '@tiptap/y-tiptap';
import {
  getPrismaClient,
  loadDocumentState,
  flushSave,
  saveDocumentState,
} from './collab-persistence.mjs';
import { flushActiveRoom, restoreActiveRoom } from './collab-internal-client.mjs';

/**
 * Recursively extracts plain text from a ProseMirror / TipTap JSON document node.
 *
 * @param {Object} node ProseMirror AST node
 * @returns {string} Flattened plain text
 */
export function extractTextFromProseMirror(node) {
  if (!node) return '';
  if (typeof node.text === 'string') return node.text;
  if (Array.isArray(node.content)) {
    return node.content.map(extractTextFromProseMirror).join(' ');
  }
  return '';
}

/**
 * Calculates word count from a ProseMirror / TipTap JSON structure.
 *
 * @param {Object|null} contentJson ProseMirror JSON doc
 * @returns {number} Non-negative word count
 */
export function calculateWordCount(contentJson) {
  if (!contentJson) return 0;
  const text = extractTextFromProseMirror(contentJson).trim();
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Retrieves the active in-memory Y.Doc for a page from the global room registry if present.
 *
 * @param {string} pageId
 * @returns {Y.Doc|null}
 */
export function getActiveRoomDoc(pageId) {
  if (globalThis.__collabRooms && globalThis.__collabRooms.has(pageId)) {
    const room = globalThis.__collabRooms.get(pageId);
    if (room && !room.isDestroyed && room.doc) {
      return room.doc;
    }
  }
  return null;
}

/**
 * Creates a version snapshot of a page from a consistent Yjs document state.
 *
 * Consistency guarantees:
 * - If an active in-memory room exists or a Y.Doc is provided, any pending
 *   persistence write is flushed first so PostgreSQL and the snapshot are aligned.
 * - Binary Yjs snapshot (yjsState) and JSON preview (content) are generated
 *   synchronously from the exact same Y.Doc revision.
 * - Word count is calculated directly from the captured document content.
 *
 * @param {string} pageId Target page identifier
 * @param {Object} [params]
 * @param {string} [params.userId] Authenticated user creating the snapshot (null for automatic)
 * @param {string} [params.label] Optional user-defined label (e.g. "Release 1.0 draft")
 * @param {string} [params.description] Optional description
 * @param {boolean} [params.isAutomatic=false] Whether this is an automatic checkpoint
 * @param {Y.Doc} [params.doc] Optional explicit Y.Doc instance
 * @param {PrismaClient} [params.prisma] Optional injected Prisma client for tests
 * @returns {Promise<Object>} Created VersionSnapshot record with createdBy relation
 */
export async function createVersionSnapshot(pageId, params = {}) {
  if (!pageId || typeof pageId !== 'string') {
    throw new Error('[VersionSnapshotService] Invalid pageId provided');
  }

  const prisma = getPrismaClient(params.prisma);

  // 1. Resolve authoritative Y.Doc
  let doc = params.doc;
  let isTempDoc = false;

  // If explicit doc is not provided, check in-process room registry (co-located runner / test environment)
  if (!doc && globalThis.__collabRooms && globalThis.__collabRooms.has(pageId)) {
    doc = getActiveRoomDoc(pageId);
  }

  if (doc) {
    // If active room doc is available directly in-process or explicit doc supplied
    try {
      await flushSave(pageId, doc, { prisma });
    } catch (err) {
      console.warn(`[VersionSnapshotService] Persistence flush before snapshot warning for "${pageId}":`, err.message);
    }
  } else {
    // Cross-Process Room Coordination:
    // Request dedicated collab server to flush in-memory edits before snapshot capture
    const flushClient = params.flushActiveRoom || flushActiveRoom;
    await flushClient(pageId, {
      port: params.collabPort,
      secret: params.internalRpcSecret,
      timeoutMs: params.rpcTimeoutMs,
    });

    // Load persisted state into a dedicated temporary Y.Doc
    doc = new Y.Doc();
    isTempDoc = true;
    await loadDocumentState(pageId, doc, { prisma });
  }

  try {
    // 2. Capture binary CRDT snapshot
    const snapshotBytes = Y.encodeStateAsUpdate(doc);
    const snapshotBuffer = Buffer.from(snapshotBytes);

    // 3. Extract matching TipTap JSON preview from the same Y.Doc revision
    let contentJson = null;
    try {
      const fragment = doc.getXmlFragment('default');
      if (fragment) {
        contentJson = yTiptap.yXmlFragmentToProsemirrorJSON(fragment);
      }
    } catch (err) {
      console.warn(`[VersionSnapshotService] Warning converting fragment to preview JSON for "${pageId}":`, err.message);
    }

    // 4. Calculate word count from the extracted preview
    const wordCount = calculateWordCount(contentJson);

    // 5. Persist snapshot record atomically into PostgreSQL
    const snapshot = await prisma.versionSnapshot.create({
      data: {
        pageId,
        createdById: params.userId || null,
        label: params.label && typeof params.label === 'string' ? params.label.trim() : null,
        description: params.description && typeof params.description === 'string' ? params.description.trim() : null,
        yjsState: snapshotBuffer,
        content: contentJson ?? undefined,
        wordCount,
        isAutomatic: Boolean(params.isAutomatic),
      },
      include: {
        createdBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    return snapshot;
  } finally {
    if (isTempDoc && doc) {
      doc.destroy();
    }
  }
}

/**
 * Creates an automatic recovery snapshot before dangerous operations (such as restoration).
 *
 * @param {string} pageId Target page identifier
 * @param {Object} [params]
 * @param {string} [params.userId] User triggering the restore
 * @param {string} [params.triggerAction='restore'] Action triggering the recovery checkpoint
 * @param {string} [params.label] Optional custom label
 * @param {Y.Doc} [params.doc] Optional active Y.Doc
 * @param {PrismaClient} [params.prisma]
 * @returns {Promise<Object>} Created VersionSnapshot record
 */
export async function createRecoverySnapshot(pageId, params = {}) {
  const triggerAction = params.triggerAction || 'restore';
  const label = params.label || `Automatic recovery snapshot before ${triggerAction}`;

  return createVersionSnapshot(pageId, {
    ...params,
    label,
    isAutomatic: true,
  });
}

/**
 * Lists version snapshots for a document, ordered newest first (createdAt DESC).
 * Excludes heavy binary BYTEA payload for lightweight list responses.
 *
 * @param {string} pageId Target page identifier
 * @param {Object} [options]
 * @param {number} [options.limit=50] Maximum snapshots to return
 * @param {PrismaClient} [options.prisma]
 * @returns {Promise<Array<Object>>} List of snapshot metadata records
 */
export async function listVersionSnapshots(pageId, options = {}) {
  if (!pageId || typeof pageId !== 'string') {
    throw new Error('[VersionSnapshotService] Invalid pageId provided to listVersionSnapshots');
  }

  const prisma = getPrismaClient(options.prisma);
  const limit = options.limit ? Math.min(100, Math.max(1, parseInt(options.limit, 10))) : 50;

  const snapshots = await prisma.versionSnapshot.findMany({
    where: { pageId },
    select: {
      id: true,
      pageId: true,
      createdById: true,
      label: true,
      description: true,
      wordCount: true,
      isAutomatic: true,
      createdAt: true,
      createdBy: {
        select: { id: true, name: true, email: true },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  return snapshots;
}

/**
 * Retrieves an individual version snapshot with full preview content.
 * Strictly verifies pageId to prevent cross-page access.
 *
 * @param {string} pageId Target page identifier
 * @param {string} snapshotId Snapshot identifier
 * @param {Object} [options]
 * @param {PrismaClient} [options.prisma]
 * @returns {Promise<Object|null>} Snapshot record or null if not found
 */
export async function getVersionSnapshot(pageId, snapshotId, options = {}) {
  if (!pageId || !snapshotId) {
    return null;
  }

  const prisma = getPrismaClient(options.prisma);

  const snapshot = await prisma.versionSnapshot.findUnique({
    where: { id: snapshotId },
    include: {
      createdBy: {
        select: { id: true, name: true, email: true },
      },
    },
  });

  if (!snapshot || snapshot.pageId !== pageId) {
    return null;
  }

  return snapshot;
}

/**
 * Safely replaces the contents of targetDoc's 'default' Y.XmlFragment with sourceDoc's
 * 'default' Y.XmlFragment in a single transactional mutation.
 *
 * Emits a regular Yjs update with origin 'restore' that cleanly synchronizes to
 * all active clients via Yjs sync protocol without merging or corrupting concurrent state.
 *
 * @param {Y.Doc} targetDoc Target document to replace
 * @param {Y.Doc} sourceDoc Historical document containing desired state
 */
export function replaceDocXmlFragment(targetDoc, sourceDoc) {
  if (!targetDoc || !sourceDoc) {
    throw new Error('[VersionSnapshotService] Both targetDoc and sourceDoc must be valid Y.Doc instances');
  }

  const sourceFrag = sourceDoc.getXmlFragment('default');
  targetDoc.transact(() => {
    const targetFrag = targetDoc.getXmlFragment('default');
    if (targetFrag.length > 0) {
      targetFrag.delete(0, targetFrag.length);
    }
    const cloned = sourceFrag.toArray().map((item) => item.clone());
    if (cloned.length > 0) {
      targetFrag.insert(0, cloned);
    }
  }, 'restore');
}

/**
 * Restores a historical version snapshot into the document.
 *
 * Guarantees:
 * 1. Verifies snapshot exists and belongs to target pageId.
 * 2. If dedicated collaboration server is running, requests active room restore via internal RPC,
 *    ensuring in-memory synchronization, active room locks, and live collaborator updates.
 * 3. Before modifying document state, an automatic recovery snapshot is created of the latest current state.
 * 4. Content replacement uses verified transactional Y.XmlFragment cloning ('restore' origin).
 * 5. Changes are persisted to PostgreSQL before returning success.
 * 6. If collab server is offline/dormant, falls back to safe direct PostgreSQL persistence restore.
 *
 * @param {string} pageId Target page identifier
 * @param {string} snapshotId Target snapshot identifier to restore
 * @param {Object} [params]
 * @param {string} [params.userId] User ID performing the restore
 * @param {PrismaClient} [params.prisma]
 * @param {Function} [params.restoreActiveRoom] Optional injected RPC client for tests
 * @param {number} [params.collabPort]
 * @param {string} [params.internalRpcSecret]
 * @param {number} [params.rpcTimeoutMs]
 * @returns {Promise<{ success: boolean, restoredVersion: Object, recoverySnapshot: Object|null }>}
 */
export async function restoreVersionSnapshot(pageId, snapshotId, params = {}) {
  if (!pageId || typeof pageId !== 'string') {
    throw new Error('[VersionSnapshotService] Invalid pageId provided to restoreVersionSnapshot');
  }
  if (!snapshotId || typeof snapshotId !== 'string') {
    throw new Error('[VersionSnapshotService] Invalid snapshotId provided to restoreVersionSnapshot');
  }

  const prisma = getPrismaClient(params.prisma);

  // 1. Verify target snapshot exists and belongs to this pageId
  const targetSnapshot = await prisma.versionSnapshot.findUnique({
    where: { id: snapshotId },
    include: {
      createdBy: {
        select: { id: true, name: true, email: true },
      },
    },
  });

  if (!targetSnapshot || targetSnapshot.pageId !== pageId) {
    const error = new Error('Version snapshot not found for document');
    error.statusCode = 404;
    throw error;
  }

  if (!targetSnapshot.yjsState || targetSnapshot.yjsState.length === 0) {
    const error = new Error('Version snapshot does not contain valid binary Yjs state');
    error.statusCode = 400;
    throw error;
  }

  // 2. Cross-Process Coordination: Try restoring through dedicated collab server if available
  const restoreClient = params.restoreActiveRoom || restoreActiveRoom;
  let rpcSuccess = false;
  let recoverySnapshot = null;

  try {
    const rpcResult = await restoreClient(pageId, {
      versionId: snapshotId,
      userId: params.userId || null,
      port: params.collabPort,
      secret: params.internalRpcSecret,
      timeoutMs: params.rpcTimeoutMs,
    });

    if (rpcResult && rpcResult.success) {
      rpcSuccess = true;
      if (rpcResult.recoverySnapshotId) {
        recoverySnapshot = await prisma.versionSnapshot.findUnique({
          where: { id: rpcResult.recoverySnapshotId },
          include: {
            createdBy: {
              select: { id: true, name: true, email: true },
            },
          },
        });
      }
    }
  } catch (rpcErr) {
    if (rpcErr.code === 'ECONNREFUSED' || rpcErr.isOfflineFallback) {
      console.warn(
        `[VersionSnapshotService] Collab server offline during restore of "${pageId}". Performing direct persistence restore.`
      );
    } else {
      // Re-throw RPC errors (like 400/404/500/timeout)
      throw rpcErr;
    }
  }

  // 3. Fallback: If collaboration server was unreachable, execute safe direct persistence restore
  if (!rpcSuccess) {
    const currentDoc = new Y.Doc();
    try {
      await loadDocumentState(pageId, currentDoc, { prisma });

      // Create automatic recovery snapshot before modifying
      recoverySnapshot = await createRecoverySnapshot(pageId, {
        userId: params.userId,
        triggerAction: 'restore',
        doc: currentDoc,
        prisma,
      });

      // Load historical snapshot into a source doc
      const sourceDoc = new Y.Doc();
      try {
        Y.applyUpdate(sourceDoc, new Uint8Array(targetSnapshot.yjsState));
        replaceDocXmlFragment(currentDoc, sourceDoc);
        // Persist restored state directly to PostgreSQL
        await saveDocumentState(pageId, currentDoc, { prisma });
      } finally {
        sourceDoc.destroy();
      }
    } finally {
      currentDoc.destroy();
    }
  }

  return {
    success: true,
    restoredVersion: targetSnapshot,
    recoverySnapshot,
  };
}

