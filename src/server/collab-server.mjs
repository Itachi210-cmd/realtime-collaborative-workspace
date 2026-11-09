/**
 * Dedicated Yjs WebSocket Collaboration Server
 * Real-Time Collaborative Workspace - Phase 6 Step 2
 *
 * Runs as a standalone Node.js ES module on port 1234 (configurable).
 * Enforces first-message JWT authentication, strict role-based authorization,
 * Origin validation, multi-room Yjs document synchronization, and
 * in-memory room cleanup with a 30-second grace period.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as authProtocol from 'y-protocols/auth';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { jwtVerify } from 'jose';
import {
  loadDocumentState,
  scheduleSave,
  flushSave,
  closePersistence,
  sanitizeAwarenessUpdate,
  hasPendingSave,
  getPrismaClient,
} from './collab-persistence.mjs';
import {
  createRecoverySnapshot,
  replaceDocXmlFragment,
} from './version-snapshot-service.mjs';
import { createCollabRedis } from './collab-redis.mjs';

// Protocol Message Constants
const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const MESSAGE_AUTH = 2;
const MESSAGE_QUERY_AWARENESS = 3;

// JWT Token Constraints (matches src/lib/auth/collab-token.ts)
const COLLAB_TOKEN_ISSUER = 'collab-workspace-auth';
const COLLAB_TOKEN_AUDIENCE = 'collab-workspace-yjs';

// Internal RPC Secret Constraint (strictly 64 hex characters / 32 random bytes)
export const INTERNAL_RPC_SECRET_REGEX = /^[0-9a-fA-F]{64}$/;

/**
 * Validates the internal RPC secret for presence and minimum cryptographic entropy.
 * Requires exactly 64 hexadecimal characters (32 random bytes).
 *
 * @param {string} secret
 * @throws {Error} If secret is missing, empty, or invalid format
 */
export function validateInternalRpcSecret(secret) {
  if (!secret || typeof secret !== 'string') {
    throw new Error(
      '[CollabServer] Fatal startup error: INTERNAL_RPC_SECRET is required and cannot be empty.'
    );
  }
  if (!INTERNAL_RPC_SECRET_REGEX.test(secret)) {
    throw new Error(
      '[CollabServer] Fatal startup error: INTERNAL_RPC_SECRET must be exactly 64 hexadecimal characters (32 cryptographically random bytes).'
    );
  }
  return true;
}

/**
 * Loads environment variables from .env.local or .env if not already set.
 */
function loadEnvIfPresent() {

  const envFiles = [
    path.resolve(process.cwd(), '.env.local'),
    path.resolve(process.cwd(), '.env'),
  ];

  for (const envPath of envFiles) {
    if (fs.existsSync(envPath)) {
      try {
        const content = fs.readFileSync(envPath, 'utf8');
        for (const line of content.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx > 0) {
            const key = trimmed.slice(0, eqIdx).trim();
            let val = trimmed.slice(eqIdx + 1).trim();
            if (
              (val.startsWith('"') && val.endsWith('"')) ||
              (val.startsWith("'") && val.endsWith("'"))
            ) {
              val = val.slice(1, -1);
            }
            if (!process.env[key]) {
              process.env[key] = val;
            }
          }
        }
      } catch (err) {
        console.warn(`[CollabServer] Failed reading ${envPath}:`, err.message);
      }
    }
  }
}

loadEnvIfPresent();

/**
 * Verifies and decodes a short-lived collaboration JWT token.
 *
 * @param {string} token
 * @returns {Promise<any>} decoded payload
 */
async function verifyCollabToken(token) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error('AUTH_SECRET is not configured in environment or .env.local');
  }

  const secretKey = new TextEncoder().encode(secret);
  const { payload } = await jwtVerify(token, secretKey, {
    algorithms: ['HS256'],
    issuer: COLLAB_TOKEN_ISSUER,
    audience: COLLAB_TOKEN_AUDIENCE,
  });

  if (
    !payload ||
    typeof payload.sub !== 'string' ||
    typeof payload.userName !== 'string' ||
    typeof payload.pageId !== 'string' ||
    typeof payload.workspaceId !== 'string' ||
    typeof payload.role !== 'string' ||
    payload.purpose !== 'collaboration'
  ) {
    throw new Error('Malformed collaboration token claims');
  }

  return payload;
}

/**
 * Sends a Yjs permission denied message to a WebSocket client.
 *
 * @param {WebSocket} ws
 * @param {string} reason
 */
function sendPermissionDenied(ws, reason) {
  try {
    if (ws.readyState === WebSocket.OPEN) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_AUTH);
      authProtocol.writePermissionDenied(encoder, reason);
      ws.send(encoding.toUint8Array(encoder));
    }
  } catch {}
}

/**
 * Creates and configures the Yjs collaboration server instance.
 *
 * @param {Object} [options]
 * @param {number} [options.port]
 * @param {string} [options.host]
 * @param {string[]} [options.allowedOrigins]
 * @param {number} [options.authTimeoutMs]
 * @param {number} [options.cleanupGraceMs]
 * @returns {Object} { server, wss, rooms, start, close }
 */
export function createCollabServer(options = {}) {
  const port = options.port ?? (process.env.COLLAB_PORT ? parseInt(process.env.COLLAB_PORT, 10) : 1234);
  const host = options.host ?? (process.env.COLLAB_HOST || undefined);
  const authTimeoutMs = options.authTimeoutMs ?? (
    process.env.COLLAB_AUTH_TIMEOUT_MS ? parseInt(process.env.COLLAB_AUTH_TIMEOUT_MS, 10) : 5000
  );
  const cleanupGraceMs = options.cleanupGraceMs ?? (
    process.env.COLLAB_CLEANUP_GRACE_MS ? parseInt(process.env.COLLAB_CLEANUP_GRACE_MS, 10) : 30000
  );

  const defaultAllowedOrigins = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3001',
  ];
  if (process.env.NEXT_PUBLIC_APP_URL) {
    defaultAllowedOrigins.push(process.env.NEXT_PUBLIC_APP_URL);
  }

  const rawOrigins = options.allowedOrigins
    ? options.allowedOrigins.join(',')
    : (process.env.COLLAB_ALLOWED_ORIGINS || defaultAllowedOrigins.join(','));
  const allowedOrigins = [...new Set(rawOrigins.split(',').map((o) => o.trim()).filter(Boolean))];

  const internalRpcSecret =
    'internalRpcSecret' in options
      ? options.internalRpcSecret
      : process.env.INTERNAL_RPC_SECRET;
  validateInternalRpcSecret(internalRpcSecret);
  const allowExternalRpc = options.allowExternalRpc ?? false;

  const instanceId = options.instanceId || `collab-${crypto.randomUUID()}`;
  const enableRedis = options.enableRedis !== false && process.env.REDIS_ENABLED !== 'false';
  const redisUrl = options.redisUrl || process.env.REDIS_URL || 'redis://localhost:6379';
  const collabRedis = options.collabRedis || createCollabRedis({
    redisUrl,
    instanceId,
    enabled: enableRedis,
    channelPrefix: options.redisChannelPrefix,
  });

  const loadState = options.loadDocumentState || loadDocumentState;

  // In-memory room storage: Map<pageId, CollabRoom>
  const rooms = new Map();
  globalThis.__collabRooms = rooms;
  // In-flight room hydration deduplication: Map<pageId, Promise<CollabRoom>>
  const roomHydrationPromises = new Map();
  // Per-page restore mutex to serialize concurrent restore operations
  const restoreLocks = new Map();
  let isShuttingDown = false;

  /**
   * Broadcasts a JSON save status update to all connected authenticated clients in a room.
   */
  function broadcastSaveStatus(targetRoom, statusPayload) {
    if (!targetRoom || targetRoom.isDestroyed) return;
    const msg = JSON.stringify(statusPayload);
    for (const client of targetRoom.clients) {
      if (client.readyState === WebSocket.OPEN && client.isCollabAuthenticated) {
        try {
          client.send(msg);
        } catch (err) {
          console.error(`[CollabServer] Error sending save status in room "${targetRoom.pageId}":`, err.message);
        }
      }
    }
  }

  /**
   * Retrieves or initializes a collaboration room for a given pageId,
   * awaiting database hydration before returning.
   *
   * @param {string} pageId
   * @returns {Promise<Object>} CollabRoom
   */
  async function getOrCreateRoom(pageId) {
    let room = rooms.get(pageId);
    if (room) {
      return room;
    }

    // Deduplicate simultaneous hydration requests for the same room
    let hydrationPromise = roomHydrationPromises.get(pageId);
    if (hydrationPromise) {
      return await hydrationPromise;
    }

    const doc = new Y.Doc();
    const awareness = new awarenessProtocol.Awareness(doc);
    const clients = new Set();

    room = {
      pageId,
      doc,
      awareness,
      clients,
      cleanupTimer: null,
      isDestroyed: false,
      lastSavedVersion: 0,
      hasUnsavedChanges: false,
      redisUnsubscribe: null,
    };

    hydrationPromise = (async () => {
      try {
        console.log(`[CollabServer] Loading persisted state for room "${pageId}"...`);
        const loadResult = await loadState(pageId, doc);
        room.lastSavedVersion = loadResult.version || 0;
        room.hasUnsavedChanges = false;
        console.log(
          `[CollabServer] Room "${pageId}" hydrated successfully (source: ${loadResult.source}, version: ${loadResult.version})`
        );

        // Subscribe to cross-instance Redis updates & awareness for this room
        if (collabRedis && collabRedis.enabled && !room.redisUnsubscribe) {
          const handleRemoteRedisUpdate = (updateBytes, payload) => {
            if (room.isDestroyed) return;
            if (payload && payload.type === 'yjs_persisted') {
              if (payload.stateVersion && payload.stateVersion >= room.lastSavedVersion) {
                room.lastSavedVersion = payload.stateVersion;
                room.hasRemoteEdits = false;
              }
              return;
            }
            if (!room.doc || !updateBytes) return;
            try {
              room.hasRemoteEdits = true;
              // Apply remote update to local Y.Doc with origin 'redis'
              Y.applyUpdate(room.doc, updateBytes, 'redis');
            } catch (err) {
              console.error(`[CollabServer] Error applying remote Redis update in room "${pageId}":`, err.message);
            }
          };

          const handleRemoteRedisAwareness = (awarenessBytes) => {
            if (room.isDestroyed || !room.awareness || !awarenessBytes) return;
            try {
              // Apply remote awareness to local room with origin 'redis'
              awarenessProtocol.applyAwarenessUpdate(room.awareness, awarenessBytes, 'redis');
            } catch (err) {
              console.error(`[CollabServer] Error applying remote Redis awareness in room "${pageId}":`, err.message);
            }
          };

          collabRedis.subscribeRoom(pageId, handleRemoteRedisUpdate);
          collabRedis.subscribeAwareness(pageId, handleRemoteRedisAwareness);

          room.redisUnsubscribe = () => {
            collabRedis.unsubscribeRoom(pageId, handleRemoteRedisUpdate);
            collabRedis.unsubscribeAwareness(pageId, handleRemoteRedisAwareness);
          };
        }

        // Attach doc update listener AFTER hydration completes so initial load doesn't trigger save
        doc.on('update', (update, origin) => {
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, MESSAGE_SYNC);
          syncProtocol.writeUpdate(encoder, update);
          const msg = encoding.toUint8Array(encoder);

          for (const client of room.clients) {
            if (client !== origin && client.readyState === WebSocket.OPEN && client.isCollabAuthenticated) {
              try {
                client.send(msg, { binary: true }, (err) => {
                  if (err) {
                    console.error(`[CollabServer] Error sending doc update in room "${pageId}":`, err.message);
                  }
                });
              } catch (err) {
                console.error(`[CollabServer] Failed broadcasting doc update in room "${pageId}":`, err);
              }
            }
          }

          // Publish to Redis if origin is not 'redis' and not 'persistence'
          if (origin !== 'redis' && origin !== 'persistence' && collabRedis && collabRedis.enabled) {
            collabRedis.publishUpdate(pageId, update, {
              origin: typeof origin === 'string' ? origin : 'client',
            }).catch((err) => {
              console.error(`[CollabServer] Failed publishing update to Redis for room "${pageId}":`, err.message);
            });
          }

          // Trigger debounced persistence for non-persistence and non-redis updates
          if (origin !== 'persistence' && origin !== 'redis' && !room.isDestroyed) {
            room.hasUnsavedChanges = true;
            broadcastSaveStatus(room, {
              type: 'save_status',
              status: 'saving',
              pageId,
            });

            scheduleSave(pageId, doc, { collabRedis, prisma: options.prisma })
              .then((saveResult) => {
                room.lastSavedVersion = saveResult.stateVersion;
                // Only mark saved if no further edits were scheduled during the save
                if (!hasPendingSave(pageId)) {
                  room.hasUnsavedChanges = false;
                  broadcastSaveStatus(room, {
                    type: 'save_status',
                    status: 'saved',
                    pageId,
                    stateVersion: saveResult.stateVersion,
                    savedAt: new Date().toISOString(),
                  });
                }
              })
              .catch((err) => {
                console.error(`[CollabServer] Error during scheduled persistence for room "${pageId}":`, err.message);
                broadcastSaveStatus(room, {
                  type: 'save_status',
                  status: 'error',
                  pageId,
                  error: 'Failed to persist document to storage',
                });
              });
          }
        });

        // Broadcast awareness updates to other authenticated room clients and Redis
        awareness.on('update', ({ added, updated, removed }, origin) => {
          const changedClients = added.concat(updated).concat(removed);
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
          const awarenessBytes = awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients);
          encoding.writeVarUint8Array(encoder, awarenessBytes);
          const msg = encoding.toUint8Array(encoder);

          for (const client of room.clients) {
            if (client !== origin && client.readyState === WebSocket.OPEN && client.isCollabAuthenticated) {
              try {
                client.send(msg, { binary: true }, (err) => {
                  if (err) {
                    console.error(`[CollabServer] Error sending awareness update in room "${pageId}":`, err.message);
                  }
                });
              } catch (err) {
                console.error(`[CollabServer] Failed broadcasting awareness update in room "${pageId}":`, err);
              }
            }
          }

          // Broadcast awareness to other server instances via Redis (if origin is not 'redis')
          if (origin !== 'redis' && collabRedis && collabRedis.enabled) {
            collabRedis.publishAwareness(pageId, awarenessBytes).catch((err) => {
              console.error(`[CollabServer] Failed publishing awareness to Redis for room "${pageId}":`, err.message);
            });
          }
        });

        rooms.set(pageId, room);
        console.log(`[CollabServer] Initialized and registered hydrated room "${pageId}"`);
        return room;
      } catch (err) {
        console.error(`[CollabServer] Failed hydrating room "${pageId}":`, err.message);
        try {
          awareness.destroy();
          doc.destroy();
        } catch {}
        rooms.delete(pageId);
        throw err;
      } finally {
        roomHydrationPromises.delete(pageId);
      }
    })();

    roomHydrationPromises.set(pageId, hydrationPromise);
    return await hydrationPromise;
  }

  // HTTP Server (Health check + Internal RPC + Upgrade routing)
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

      // 1. Health check endpoint
      if (url.pathname === '/health' || url.pathname === '/healthz') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            status: 'ok',
            instanceId,
            uptime: process.uptime(),
            roomsCount: rooms.size,
            rooms: Array.from(rooms.keys()),
            redis: {
              enabled: Boolean(collabRedis && collabRedis.enabled),
              status: collabRedis ? collabRedis.status : 'disabled',
            },
          })
        );
        return;
      }

      // 2. Internal RPC endpoints: /internal/*
      if (url.pathname.startsWith('/internal/')) {
        // Match: POST /internal/rooms/:pageId/flush
        const flushMatch = url.pathname.match(/^\/internal\/rooms\/([^/]+)\/flush$/);
        if (flushMatch) {
          // Verify request originated from loopback interface
          const remoteAddress = req.socket?.remoteAddress;
          const isLoopback =
            remoteAddress === '127.0.0.1' ||
            remoteAddress === '::1' ||
            remoteAddress === '::ffff:127.0.0.1' ||
            remoteAddress === 'localhost';

          if (!isLoopback && !allowExternalRpc) {
            console.warn(`[CollabServer] Rejected non-loopback internal RPC attempt from: ${remoteAddress}`);
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Forbidden: Internal RPC restricted to loopback address' }));
            return;
          }

          // Authenticate with shared internal RPC secret using constant-time comparison
          const authHeader = req.headers['authorization'] || '';
          const [scheme, token] = authHeader.split(' ');

          let isAuthValid = false;
          if (scheme === 'Bearer' && token && typeof token === 'string') {
            const expectedBuf = Buffer.from(internalRpcSecret, 'utf8');
            const actualBuf = Buffer.from(token, 'utf8');
            if (expectedBuf.length === actualBuf.length) {
              isAuthValid = crypto.timingSafeEqual(expectedBuf, actualBuf);
            }
          }

          if (!isAuthValid) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Unauthorized: Invalid internal RPC secret' }));
            return;
          }

          // Validate HTTP method
          if (req.method !== 'POST') {
            res.writeHead(405, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Method Not Allowed: Expected POST' }));
            return;
          }

          // Extract and validate pageId
          const pageId = decodeURIComponent(flushMatch[1]).trim();
          if (!pageId || pageId.length > 255) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid pageId parameter' }));
            return;
          }

          // Await room hydration if in progress
          let room = rooms.get(pageId);
          if (!room && roomHydrationPromises.has(pageId)) {
            try {
              room = await roomHydrationPromises.get(pageId);
            } catch (err) {
              console.error(`[CollabServer] Room hydration failed during internal flush for "${pageId}":`, err.message);
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                success: false,
                active: true,
                flushed: false,
                pageId,
                error: 'Room hydration failed',
                detail: err.message,
              }));
              return;
            }
          }

          // If no active in-memory room exists
          if (!room || room.isDestroyed || !room.doc) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: true,
              active: false,
              flushed: false,
              pageId,
              message: 'No active in-memory room found for document',
            }));
            return;
          }

          // Active room exists: flush its actual Y.Doc to PostgreSQL persistence
          try {
            const saveResult = await flushSave(pageId, room.doc, { prisma: options.prisma, collabRedis });
            room.lastSavedVersion = saveResult.stateVersion;
            room.hasUnsavedChanges = false;

            broadcastSaveStatus(room, {
              type: 'save_status',
              status: 'saved',
              pageId,
              stateVersion: saveResult.stateVersion,
              savedAt: new Date().toISOString(),
            });

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: true,
              active: true,
              flushed: true,
              pageId,
              stateVersion: saveResult.stateVersion,
            }));
          } catch (err) {
            console.error(`[CollabServer] Error during internal flush for "${pageId}":`, err.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: false,
              active: true,
              flushed: false,
              pageId,
              error: 'Failed to flush active room to persistence',
              detail: err.message,
            }));
          }
          return;
        }

        // Match: POST /internal/rooms/:pageId/restore
        const restoreMatch = url.pathname.match(/^\/internal\/rooms\/([^/]+)\/restore$/);
        if (restoreMatch) {
          // 1. Verify loopback origin
          const remoteAddress = req.socket?.remoteAddress;
          const isLoopback =
            remoteAddress === '127.0.0.1' ||
            remoteAddress === '::1' ||
            remoteAddress === '::ffff:127.0.0.1' ||
            remoteAddress === 'localhost';

          if (!isLoopback && !allowExternalRpc) {
            console.warn(`[CollabServer] Rejected non-loopback internal RPC restore attempt from: ${remoteAddress}`);
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Forbidden: Internal RPC restricted to loopback address' }));
            return;
          }

          // 2. Authenticate with shared internal RPC secret using constant-time comparison
          const authHeader = req.headers['authorization'] || '';
          const [scheme, token] = authHeader.split(' ');

          let isAuthValid = false;
          if (scheme === 'Bearer' && token && typeof token === 'string') {
            const expectedBuf = Buffer.from(internalRpcSecret, 'utf8');
            const actualBuf = Buffer.from(token, 'utf8');
            if (expectedBuf.length === actualBuf.length) {
              isAuthValid = crypto.timingSafeEqual(expectedBuf, actualBuf);
            }
          }

          if (!isAuthValid) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Unauthorized: Invalid internal RPC secret' }));
            return;
          }

          // 3. Validate HTTP method
          if (req.method !== 'POST') {
            res.writeHead(405, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Method Not Allowed: Expected POST' }));
            return;
          }

          // 4. Extract and validate pageId
          const pageId = decodeURIComponent(restoreMatch[1]).trim();
          if (!pageId || pageId.length > 255) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid pageId parameter' }));
            return;
          }

          // 5. Parse JSON request body
          let bodyText = '';
          try {
            bodyText = await new Promise((resolve, reject) => {
              let accumulated = '';
              req.on('data', (chunk) => {
                accumulated += chunk;
                if (accumulated.length > 10 * 1024 * 1024) {
                  req.destroy();
                  reject(new Error('Payload Too Large'));
                }
              });
              req.on('end', () => resolve(accumulated));
              req.on('error', reject);
            });
          } catch (err) {
            res.writeHead(413, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
            return;
          }

          let body = {};
          try {
            body = bodyText ? JSON.parse(bodyText) : {};
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid JSON request body' }));
            return;
          }

          const versionId = body.versionId;
          if (!versionId || typeof versionId !== 'string') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing or invalid versionId parameter' }));
            return;
          }

          const userId = body.userId || null;
          const prisma = getPrismaClient(options.prisma);

          // 6. Acquire per-page local restore mutex to serialize concurrent restores in this process
          let unlock;
          const lockPromise = new Promise((resolve) => {
            unlock = resolve;
          });
          const previousLock = restoreLocks.get(pageId) || Promise.resolve();
          restoreLocks.set(pageId, lockPromise);

          let distRestoreLock = null;
          try {
            await previousLock;

            // 7. Acquire cross-instance distributed restore lock
            if (collabRedis && collabRedis.enabled) {
              distRestoreLock = await collabRedis.acquireRestoreLock(pageId, 15000);
              if (!distRestoreLock.acquired) {
                res.writeHead(409, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                  error: 'Conflict: Document restoration is currently in progress on another server instance',
                }));
                return;
              }
            }

            // 8. Await room hydration if in progress, or hydrate room
            let room = rooms.get(pageId);
            if (!room && roomHydrationPromises.has(pageId)) {
              try {
                room = await roomHydrationPromises.get(pageId);
              } catch (err) {
                console.error(`[CollabServer] Room hydration failed during restore for "${pageId}":`, err.message);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                  success: false,
                  error: 'Room hydration failed',
                  detail: err.message,
                }));
                return;
              }
            }

            if (!room || room.isDestroyed || !room.doc) {
              room = await getOrCreateRoom(pageId);
            }

            // 8. Flush pending edits on the active room before modifying anything
            if (room.hasUnsavedChanges || hasPendingSave(pageId)) {
              await flushSave(pageId, room.doc, { prisma: options.prisma, collabRedis });
              room.hasUnsavedChanges = false;
            }

            // 9. Create an automatic recovery snapshot of the latest current state
            const recoverySnapshot = await createRecoverySnapshot(pageId, {
              userId,
              doc: room.doc,
              triggerAction: 'restore',
              prisma: options.prisma,
            });

            // 10. Load and validate the requested historical snapshot from PostgreSQL
            const historicalSnapshot = await prisma.versionSnapshot.findUnique({
              where: { id: versionId },
              include: {
                createdBy: {
                  select: { id: true, name: true, email: true },
                },
              },
            });

            if (!historicalSnapshot || historicalSnapshot.pageId !== pageId) {
              res.writeHead(404, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Historical version snapshot not found for document' }));
              return;
            }

            if (!historicalSnapshot.yjsState || historicalSnapshot.yjsState.length === 0) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Historical snapshot does not contain binary Yjs state' }));
              return;
            }

            // 11. Replace active Yjs document content in verified 'restore' transaction
            const tempDoc = new Y.Doc();
            try {
              Y.applyUpdate(tempDoc, new Uint8Array(historicalSnapshot.yjsState));
              replaceDocXmlFragment(room.doc, tempDoc);
            } finally {
              tempDoc.destroy();
            }

            // 12. Immediately persist restored state to PostgreSQL DocumentState and Page.content
            const saveResult = await flushSave(pageId, room.doc, { prisma: options.prisma, collabRedis });
            room.lastSavedVersion = saveResult.stateVersion;
            room.hasUnsavedChanges = false;

            broadcastSaveStatus(room, {
              type: 'save_status',
              status: 'saved',
              pageId,
              stateVersion: saveResult.stateVersion,
              savedAt: new Date().toISOString(),
            });

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: true,
              pageId,
              restoredVersionId: historicalSnapshot.id,
              recoverySnapshotId: recoverySnapshot.id,
              stateVersion: saveResult.stateVersion,
            }));
          } catch (err) {
            console.error(`[CollabServer] Error during restore for "${pageId}":`, err.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: false,
              error: 'Failed to restore document',
              detail: err.message,
            }));
          } finally {
            if (distRestoreLock && typeof distRestoreLock.release === 'function') {
              try {
                await distRestoreLock.release();
              } catch {}
            }
            unlock();
            if (restoreLocks.get(pageId) === lockPromise) {
              restoreLocks.delete(pageId);
            }
          }
          return;
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal RPC endpoint not found' }));
        return;
      }

      // Default fallback
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    } catch (err) {
      console.error('[CollabServer] Unhandled HTTP error:', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal Server Error' }));
      }
    }
  });

  // WebSocket Server (noServer mode to handle custom upgrade authorization)
  const wss = new WebSocketServer({ noServer: true });

  // HTTP Upgrade Handler: Origin validation and URL path inspection
  server.on('upgrade', (req, socket, head) => {
    const origin = req.headers['origin'];

    // Reject untrusted origin if present
    if (origin && !allowedOrigins.includes(origin)) {
      console.warn(`[CollabServer] Upgrade rejected: Untrusted Origin "${origin}"`);
      socket.write(
        'HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Type: text/plain\r\n\r\nForbidden: Untrusted Origin\r\n'
      );
      socket.destroy();
      return;
    }

    const hostHeader = req.headers.host || 'localhost';
    const parsedUrl = new URL(req.url, `http://${hostHeader}`);

    // Strictly forbid JWT tokens in the URL parameters
    if (
      parsedUrl.searchParams.has('token') ||
      parsedUrl.searchParams.has('jwt') ||
      parsedUrl.searchParams.has('auth')
    ) {
      console.warn('[CollabServer] Upgrade rejected: Token in URL query string is forbidden.');
      socket.write(
        'HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Type: text/plain\r\n\r\nBad Request: Tokens in URL forbidden\r\n'
      );
      socket.destroy();
      return;
    }

    // Extract pageId from path: /:pageId or /rooms/:pageId or query param
    const segments = parsedUrl.pathname.replace(/^\/+/, '').split('/').filter(Boolean);
    let pageId = null;

    if (segments.length > 0) {
      if ((segments[0] === 'room' || segments[0] === 'rooms') && segments.length > 1) {
        pageId = segments[1];
      } else {
        pageId = segments[0];
      }
    } else if (parsedUrl.searchParams.has('room') || parsedUrl.searchParams.has('pageId')) {
      pageId = parsedUrl.searchParams.get('room') || parsedUrl.searchParams.get('pageId');
    }

    if (!pageId) {
      console.warn('[CollabServer] Upgrade rejected: Missing pageId in URL.');
      socket.write(
        'HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Type: text/plain\r\n\r\nBad Request: Missing room pageId\r\n'
      );
      socket.destroy();
      return;
    }

    // Upgrade socket and emit connection with target pageId
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, pageId);
    });
  });

  // WebSocket Connection Handler
  wss.on('connection', (ws, req, pageId) => {
    ws.isCollabAuthenticated = false;
    ws.pageId = pageId;

    // Strict 5-second First-Message Authentication Gate
    const authTimer = setTimeout(() => {
      if (!ws.isCollabAuthenticated) {
        console.warn(`[CollabServer] Auth timeout expired for connection on room "${pageId}"`);
        sendPermissionDenied(ws, 'Authentication timeout: No token received within 5 seconds');
        try {
          ws.close(4401, 'Authentication timeout');
        } catch {}
        ws.terminate();
      }
    }, authTimeoutMs);

    let isAuthenticating = false;
    const pendingPreAuthQueue = [];

    // Initial message handler for authentication
    ws.on('message', async (data, isBinary) => {
      if (!ws.isCollabAuthenticated) {
        if (isAuthenticating) {
          // If auth is already in flight, queue incoming traffic until verification resolves
          pendingPreAuthQueue.push({ data, isBinary });
          return;
        }

        isAuthenticating = true;
        await handleFirstMessageAuth(ws, data, isBinary, pageId, authTimer);
        isAuthenticating = false;

        // If authenticated successfully, flush any traffic that arrived during the verification window
        if (ws.isCollabAuthenticated) {
          while (pendingPreAuthQueue.length > 0) {
            const next = pendingPreAuthQueue.shift();
            if (next) {
              handleRoomMessage(ws, next.data, next.isBinary, pageId);
            }
          }
        }
      } else {
        handleRoomMessage(ws, data, isBinary, pageId);
      }
    });

    // Cleanup on disconnect
    ws.on('close', () => {
      clearTimeout(authTimer);
      if (ws.isCollabAuthenticated) {
        handleClientDisconnect(ws, pageId);
      }
    });

    ws.on('error', (err) => {
      clearTimeout(authTimer);
      console.error(`[CollabServer] Socket error on room "${pageId}":`, err.message);
    });
  });

  /**
   * Evaluates first message from client for valid collaboration authentication.
   */
  async function handleFirstMessageAuth(ws, data, isBinary, pageId, authTimer) {
    let token = null;
    let isJson = false;

    // 1. Text / JSON frame
    if (typeof data === 'string') {
      try {
        const json = JSON.parse(data);
        if (json && typeof json.token === 'string') {
          token = json.token;
          isJson = true;
        }
      } catch {}
    } else if (Buffer.isBuffer(data) || data instanceof Uint8Array) {
      // 2. Buffer containing JSON string
      try {
        const str = Buffer.from(data).toString('utf8');
        if (str.trim().startsWith('{')) {
          const json = JSON.parse(str);
          if (json && typeof json.token === 'string') {
            token = json.token;
            isJson = true;
          }
        }
      } catch {}

      // 3. Binary frame starting with MESSAGE_AUTH (2)
      if (!token) {
        try {
          const decoder = decoding.createDecoder(new Uint8Array(data));
          const msgType = decoding.readVarUint(decoder);
          if (msgType === MESSAGE_AUTH) {
            token = decoding.readVarString(decoder);
          }
        } catch {}
      }
    }

    // Reject non-auth initial messages
    if (!token) {
      clearTimeout(authTimer);
      console.warn(`[CollabServer] Non-auth message received before authenticating on room "${pageId}". Rejecting.`);
      sendPermissionDenied(ws, 'Unauthenticated: First message must be authentication frame');
      try {
        ws.close(4401, 'Unauthenticated: Authentication token required');
      } catch {}
      ws.terminate();
      return;
    }

    // Verify token with Jose
    let payload;
    try {
      payload = await verifyCollabToken(token);
    } catch (err) {
      clearTimeout(authTimer);
      console.warn(`[CollabServer] JWT verification failed on room "${pageId}":`, err.message);
      sendPermissionDenied(ws, `Invalid or expired token: ${err.message}`);
      try {
        ws.close(4401, 'Invalid or expired collaboration token');
      } catch {}
      ws.terminate();
      return;
    }

    // Validate pageId match
    if (payload.pageId !== pageId) {
      clearTimeout(authTimer);
      console.warn(`[CollabServer] PageId mismatch: token has "${payload.pageId}", requested "${pageId}"`);
      sendPermissionDenied(ws, 'Unauthorized: Token pageId does not match room');
      try {
        ws.close(4403, 'Unauthorized: Token pageId mismatch');
      } catch {}
      ws.terminate();
      return;
    }

    // Validate role authorization: all four workspace roles allowed
    const validRoles = ['OWNER', 'EDITOR', 'COMMENTER', 'VIEWER'];
    if (!validRoles.includes(payload.role)) {
      clearTimeout(authTimer);
      console.warn(`[CollabServer] Role rejected: "${payload.role}" on room "${pageId}"`);
      sendPermissionDenied(ws, `Forbidden: Role ${payload.role} is not permitted to collaborate`);
      try {
        ws.close(4403, `Forbidden: Role ${payload.role} not permitted`);
      } catch {}
      ws.terminate();
      return;
    }

    // Authentication succeeded
    clearTimeout(authTimer);
    ws.isCollabAuthenticated = true;
    ws.collabUser = {
      userId: payload.sub,
      userName: payload.userName,
      role: payload.role,
      workspaceId: payload.workspaceId,
    };

    let room;
    try {
      room = await getOrCreateRoom(pageId);
    } catch (err) {
      console.error(`[CollabServer] Room hydration failed for "${pageId}":`, err.message);
      sendPermissionDenied(ws, 'Internal Error: Document state hydration failed');
      try {
        ws.close(1011, 'Document state hydration failed');
      } catch {}
      ws.terminate();
      return;
    }
    room.clients.add(ws);

    // Cancel pending cleanup timer if client connected
    if (room.cleanupTimer) {
      clearTimeout(room.cleanupTimer);
      room.cleanupTimer = null;
      console.log(`[CollabServer] Canceled cleanup timer for room "${pageId}". Active clients: ${room.clients.size}`);
    }

    console.log(
      `[CollabServer] Authenticated user "${payload.userName}" (${payload.role}) in room "${pageId}". Total clients: ${room.clients.size}`
    );

    // Send JSON acknowledgment if client authenticated via JSON
    if (isJson) {
      try {
        ws.send(
          JSON.stringify({
            type: 'authenticated',
            pageId,
            user: ws.collabUser,
            stateVersion: room.lastSavedVersion,
            saveStatus: room.hasUnsavedChanges ? 'saving' : 'saved',
          })
        );
      } catch {}
    }

    // Always send initial save_status frame to authenticated client
    try {
      ws.send(
        JSON.stringify({
          type: 'save_status',
          status: room.hasUnsavedChanges ? 'saving' : 'saved',
          pageId,
          stateVersion: room.lastSavedVersion,
        })
      );
    } catch {}

    // Initiate Yjs sync: Send server's Sync Step 1
    try {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeSyncStep1(encoder, room.doc);
      ws.send(encoding.toUint8Array(encoder), { binary: true });
    } catch (err) {
      console.error(`[CollabServer] Error sending sync step 1 in room "${pageId}":`, err);
    }

    // Send existing awareness states if any exist
    try {
      const awarenessStates = room.awareness.getStates();
      if (awarenessStates.size > 0) {
        const awarenessEncoder = encoding.createEncoder();
        encoding.writeVarUint(awarenessEncoder, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(
          awarenessEncoder,
          awarenessProtocol.encodeAwarenessUpdate(
            room.awareness,
            Array.from(awarenessStates.keys())
          )
        );
        ws.send(encoding.toUint8Array(awarenessEncoder), { binary: true });
      }
    } catch (err) {
      console.error(`[CollabServer] Error sending awareness states in room "${pageId}":`, err);
    }
  }

  /**
   * Handles binary and control messages from authenticated clients.
   */
  function handleRoomMessage(ws, data, isBinary, pageId) {
    const room = rooms.get(pageId);
    if (!room) {
      console.warn(`[CollabServer] Message for non-existent room "${pageId}"`);
      return;
    }

    // Check for JSON control frames (ping/pong, test signals, save_retry)
    if (
      typeof data === 'string' ||
      (!isBinary && typeof data === 'object' && !(data instanceof Uint8Array) && !Buffer.isBuffer(data))
    ) {
      try {
        const parsed = typeof data === 'string' ? JSON.parse(data) : data;
        if (parsed.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
        } else if (parsed.type === 'save_retry') {
          broadcastSaveStatus(room, {
            type: 'save_status',
            status: 'saving',
            pageId,
          });
          scheduleSave(pageId, room.doc)
            .then((saveResult) => {
              room.lastSavedVersion = saveResult.stateVersion;
              if (!hasPendingSave(pageId)) {
                room.hasUnsavedChanges = false;
                broadcastSaveStatus(room, {
                  type: 'save_status',
                  status: 'saved',
                  pageId,
                  stateVersion: saveResult.stateVersion,
                  savedAt: new Date().toISOString(),
                });
              }
            })
            .catch((err) => {
              console.error(`[CollabServer] Retry save error for room "${pageId}":`, err.message);
              broadcastSaveStatus(room, {
                type: 'save_status',
                status: 'error',
                pageId,
                error: 'Failed to persist document to storage',
              });
            });
        }
      } catch {}
      return;
    }

    try {
      const uint8 = new Uint8Array(data);
      const decoder = decoding.createDecoder(uint8);
      const messageType = decoding.readVarUint(decoder);

      switch (messageType) {
        case MESSAGE_SYNC: {
          const syncMessageType = decoding.readVarUint(decoder);
          const isReadOnly = ws.collabUser?.role === 'COMMENTER' || ws.collabUser?.role === 'VIEWER';

          if (syncMessageType === syncProtocol.messageYjsSyncStep1) {
            // Sync Step 1: Handshake requesting missing document state
            // Permitted for ALL roles so read-only users receive the document
            const replyEncoder = encoding.createEncoder();
            encoding.writeVarUint(replyEncoder, MESSAGE_SYNC);
            syncProtocol.readSyncStep1(decoder, replyEncoder, room.doc);
            if (encoding.length(replyEncoder) > 1) {
              ws.send(encoding.toUint8Array(replyEncoder), { binary: true });
            }
          } else if (syncMessageType === syncProtocol.messageYjsSyncStep2) {
            // Sync Step 2: Client returning state in response to server's Step 1
            if (isReadOnly) {
              const updateBytes = decoding.readVarUint8Array(decoder);
              if (updateBytes.length > 2) {
                console.warn(
                  `[CollabServer] Dropped unauthorized SyncStep2 update (${updateBytes.length} bytes) from read-only user "${ws.collabUser?.userName}" (${ws.collabUser?.role}) in room "${pageId}"`
                );
                sendPermissionDenied(
                  ws,
                  `Forbidden: Read-only role ${ws.collabUser?.role} cannot submit document changes.`
                );
                try {
                  ws.send(
                    JSON.stringify({
                      type: 'permission_denied',
                      reason: `Forbidden: Read-only role ${ws.collabUser?.role} cannot submit document changes.`,
                      role: ws.collabUser?.role,
                    })
                  );
                } catch {}
              }
            } else {
              // OWNER or EDITOR: apply update to room.doc
              syncProtocol.readSyncStep2(decoder, room.doc, ws);
            }
          } else if (syncMessageType === syncProtocol.messageYjsUpdate) {
            // Incremental document update
            if (isReadOnly) {
              const updateBytes = decoding.readVarUint8Array(decoder);
              console.warn(
                `[CollabServer] Dropped unauthorized Yjs update (${updateBytes.length} bytes) from read-only user "${ws.collabUser?.userName}" (${ws.collabUser?.role}) in room "${pageId}"`
              );
              sendPermissionDenied(
                ws,
                `Forbidden: Read-only role ${ws.collabUser?.role} cannot submit document changes.`
              );
              try {
                ws.send(
                  JSON.stringify({
                    type: 'permission_denied',
                    reason: `Forbidden: Read-only role ${ws.collabUser?.role} cannot submit document changes.`,
                    role: ws.collabUser?.role,
                  })
                );
              } catch {}
            } else {
              // OWNER or EDITOR: apply update to room.doc
              syncProtocol.readUpdate(decoder, room.doc, ws);
            }
          } else {
            console.warn(`[CollabServer] Unknown sync message type ${syncMessageType} in room "${pageId}"`);
          }
          break;
        }
        case MESSAGE_AWARENESS: {
          const rawAwarenessUpdate = decoding.readVarUint8Array(decoder);
          let sanitizedAwarenessUpdate = rawAwarenessUpdate;

          // Enforce server-side identity binding using verified JWT credentials
          if (ws.collabUser) {
            try {
              sanitizedAwarenessUpdate = sanitizeAwarenessUpdate(rawAwarenessUpdate, ws.collabUser);
            } catch (err) {
              console.error(`[CollabServer] Error sanitizing awareness update in room "${pageId}":`, err.message);
            }
          }

          // Track controlled client IDs for this connection to enable immediate disconnect cleanup
          try {
            const updateDecoder = decoding.createDecoder(sanitizedAwarenessUpdate);
            const updateLen = decoding.readVarUint(updateDecoder);
            for (let i = 0; i < updateLen; i++) {
              const clientID = decoding.readVarUint(updateDecoder);
              decoding.readVarUint(updateDecoder); // skip clock
              const stateStr = decoding.readVarString(updateDecoder);
              if (!ws.collabAwarenessClientIds) {
                ws.collabAwarenessClientIds = new Set();
              }
              if (stateStr === 'null') {
                ws.collabAwarenessClientIds.delete(clientID);
              } else {
                ws.collabAwarenessClientIds.add(clientID);
              }
            }
          } catch {}

          awarenessProtocol.applyAwarenessUpdate(
            room.awareness,
            sanitizedAwarenessUpdate,
            ws
          );
          break;
        }
        case MESSAGE_QUERY_AWARENESS: {
          const replyEncoder = encoding.createEncoder();
          encoding.writeVarUint(replyEncoder, MESSAGE_AWARENESS);
          encoding.writeVarUint8Array(
            replyEncoder,
            awarenessProtocol.encodeAwarenessUpdate(
              room.awareness,
              Array.from(room.awareness.getStates().keys())
            )
          );
          ws.send(encoding.toUint8Array(replyEncoder), { binary: true });
          break;
        }
        default:
          console.warn(`[CollabServer] Unknown message type ${messageType} in room "${pageId}"`);
          break;
      }
    } catch (err) {
      console.error(`[CollabServer] Error handling room message in room "${pageId}":`, err);
    }
  }

  /**
   * Handles client disconnect and schedules room cleanup when room becomes empty.
   */
  function handleClientDisconnect(ws, pageId) {
    const room = rooms.get(pageId);
    if (!room) return;

    room.clients.delete(ws);
    console.log(
      `[CollabServer] Client disconnected from room "${pageId}". Remaining clients: ${room.clients.size}`
    );

    // Immediately remove this connection's awareness states to prevent ghost cursors and stale avatars
    if (ws.collabAwarenessClientIds && ws.collabAwarenessClientIds.size > 0) {
      const clientIdsToRemove = Array.from(ws.collabAwarenessClientIds);
      try {
        awarenessProtocol.removeAwarenessStates(
          room.awareness,
          clientIdsToRemove,
          null
        );
      } catch (err) {
        console.error(`[CollabServer] Error removing awareness states for room "${pageId}":`, err);
      }
      ws.collabAwarenessClientIds.clear();
    }

    // When last client leaves, schedule room disposal after grace period (if server is not shutting down)
    if (room.clients.size === 0 && !isShuttingDown && !room.isDestroyed) {
      console.log(
        `[CollabServer] Room "${pageId}" is empty. Starting ${cleanupGraceMs}ms cleanup timer.`
      );
      room.cleanupTimer = setTimeout(async () => {
        if (room.clients.size === 0) {
          console.log(`[CollabServer] Room cleanup timer expired. Flushing and destroying room "${pageId}".`);
          try {
            if (room.hasUnsavedChanges || room.hasRemoteEdits || hasPendingSave(pageId)) {
              await flushSave(pageId, room.doc, { prisma: options.prisma, collabRedis });
              console.log(`[CollabServer] Successfully flushed state for room "${pageId}" before disposal.`);
            }
            if (room.redisUnsubscribe) {
              try {
                room.redisUnsubscribe();
              } catch {}
              room.redisUnsubscribe = null;
            }
            room.isDestroyed = true;
            room.awareness.destroy();
            room.doc.destroy();
            rooms.delete(pageId);
          } catch (err) {
            console.error(`[CollabServer] Failed flushing state during room destruction for "${pageId}":`, err.message);
            // If the failure is because the page was deleted in DB (foreign key error), prune room to prevent memory leak
            if (
              err.code === 'P2003' ||
              (err.message && (err.message.includes('Foreign key') || err.message.includes('foreign key')))
            ) {
              if (room.redisUnsubscribe) {
                try {
                  room.redisUnsubscribe();
                } catch {}
                room.redisUnsubscribe = null;
              }
              room.isDestroyed = true;
              room.awareness.destroy();
              room.doc.destroy();
              rooms.delete(pageId);
            }
            // Retain room in memory for transient connection failures so pending changes are not lost
          }
        }
      }, cleanupGraceMs);
    }
  }

  /**
   * Starts listening on the configured port and host.
   */
  async function start() {
    if (collabRedis && collabRedis.enabled) {
      try {
        await collabRedis.connect();
      } catch (err) {
        console.error(`[CollabServer] Redis connection failed on startup for instance "${instanceId}":`, err.message);
      }
    }

    return new Promise((resolve, reject) => {
      const onListening = () => {
        const boundHost = host || 'dual-stack (0.0.0.0 / ::)';
        console.log(`[CollabServer] Yjs WebSocket server listening on port ${port} (${boundHost}) [instance: ${instanceId}]`);
        console.log(`[CollabServer] Allowed Origins: ${allowedOrigins.join(', ')}`);
        console.log(`[CollabServer] Auth Timeout: ${authTimeoutMs}ms | Cleanup Grace: ${cleanupGraceMs}ms`);
        if (collabRedis && collabRedis.enabled) {
          console.log(`[CollabServer] Redis Pub/Sub enabled (status: ${collabRedis.status})`);
        }
        resolve({ server, port, host, instanceId });
      };

      if (host) {
        server.listen(port, host, onListening);
      } else {
        server.listen(port, onListening);
      }
      server.on('error', reject);
    });
  }

  /**
   * Gracefully shuts down the server, closing all sockets and rooms.
   */
  async function close() {
    isShuttingDown = true;

    // 1. Clear room cleanup timers
    for (const room of rooms.values()) {
      if (room.cleanupTimer) {
        clearTimeout(room.cleanupTimer);
        room.cleanupTimer = null;
      }
    }

    // 2. Disconnect active clients gracefully and remove awareness
    for (const room of rooms.values()) {
      const allControlledClients = [];
      for (const client of room.clients) {
        if (client.collabAwarenessClientIds && client.collabAwarenessClientIds.size > 0) {
          allControlledClients.push(...client.collabAwarenessClientIds);
          client.collabAwarenessClientIds.clear();
        }
        try {
          client.close(1001, 'Server shutting down');
        } catch {}
      }
      if (allControlledClients.length > 0 && !room.isDestroyed && room.awareness) {
        try {
          awarenessProtocol.removeAwarenessStates(room.awareness, allControlledClients, null);
        } catch {}
      }
    }

    // 3. Flush all active rooms with unsaved edits to PostgreSQL in parallel
    const flushPromises = [];
    for (const [pageId, room] of rooms.entries()) {
      if (room.hasUnsavedChanges || hasPendingSave(pageId)) {
        flushPromises.push(
          flushSave(pageId, room.doc, { prisma: options.prisma, collabRedis })
            .then((flushResult) => {
              if (flushResult) {
                room.lastSavedVersion = flushResult.stateVersion;
                room.hasUnsavedChanges = false;
              }
              console.log(`[CollabServer] Flushed room "${pageId}" on shutdown.`);
              return flushResult;
            })
            .catch((err) => {
              console.error(`[CollabServer] Error flushing room "${pageId}" on shutdown:`, err.message);
              throw err;
            })
        );
      }
    }
    const flushResults = await Promise.allSettled(flushPromises);
    const failedFlushes = flushResults.filter((r) => r.status === 'rejected');
    if (failedFlushes.length > 0) {
      console.warn(`[CollabServer] ${failedFlushes.length} room(s) failed to flush during shutdown.`);
    }

    // 4. Destroy room CRDTs and unsubscribe from Redis
    for (const room of rooms.values()) {
      if (room.redisUnsubscribe) {
        try {
          room.redisUnsubscribe();
        } catch {}
        room.redisUnsubscribe = null;
      }
      try {
        room.isDestroyed = true;
        room.awareness.destroy();
        room.doc.destroy();
      } catch {}
    }
    rooms.clear();
    if (globalThis.__collabRooms === rooms) {
      delete globalThis.__collabRooms;
    }

    // 5. Close Redis clients
    if (collabRedis && collabRedis.enabled) {
      try {
        await collabRedis.close();
      } catch (err) {
        console.warn('[CollabServer] Error closing Redis client during shutdown:', err.message);
      }
    }

    // 6. Close WebSocket server and HTTP server
    await new Promise((resolve) => {
      wss.close(() => {
        server.close(resolve);
      });
    });

    // 7. Close persistence pool if requested
    if (options.closePersistence === true) {
      await closePersistence();
    }
    console.log('[CollabServer] Server shutdown complete.');
  }

  return {
    server,
    wss,
    rooms,
    port,
    host,
    instanceId,
    collabRedis,
    start,
    close,
  };
}

/**
 * Convenience runner to start the server.
 */
export async function startCollabServer(options = {}) {
  const instance = createCollabServer(options);
  await instance.start();
  return instance;
}

// Auto-run if executed directly as entrypoint
function isDirectExecution() {
  if (!process.argv[1]) return false;
  try {
    return path.resolve(import.meta.filename).toLowerCase() === path.resolve(process.argv[1]).toLowerCase();
  } catch {
    return false;
  }
}

if (isDirectExecution()) {
  let serverInstance = null;
  const gracefulExit = async (signal) => {
    console.log(`[CollabServer] Received ${signal}. Initiating graceful shutdown...`);
    if (serverInstance) {
      try {
        await serverInstance.close();
      } catch (err) {
        console.error('[CollabServer] Error during shutdown:', err);
      }
    }
    process.exit(0);
  };

  process.on('SIGINT', () => gracefulExit('SIGINT'));
  process.on('SIGTERM', () => gracefulExit('SIGTERM'));

  startCollabServer()
    .then((inst) => {
      serverInstance = inst;
    })
    .catch((err) => {
      console.error('[CollabServer] Fatal startup error:', err);
      process.exit(1);
    });
}
