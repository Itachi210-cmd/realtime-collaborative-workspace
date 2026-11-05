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
} from './collab-persistence.mjs';

// Protocol Message Constants
const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const MESSAGE_AUTH = 2;
const MESSAGE_QUERY_AWARENESS = 3;

// JWT Token Constraints (matches src/lib/auth/collab-token.ts)
const COLLAB_TOKEN_ISSUER = 'collab-workspace-auth';
const COLLAB_TOKEN_AUDIENCE = 'collab-workspace-yjs';

/**
 * Loads environment variables from .env.local or .env if not already set.
 */
function loadEnvIfPresent() {
  if (process.env.AUTH_SECRET) return;

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

  const loadState = options.loadDocumentState || loadDocumentState;

  // In-memory room storage: Map<pageId, CollabRoom>
  const rooms = new Map();
  // In-flight room hydration deduplication: Map<pageId, Promise<CollabRoom>>
  const roomHydrationPromises = new Map();
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

          // Trigger debounced persistence for non-persistence updates
          if (origin !== 'persistence' && !room.isDestroyed) {
            room.hasUnsavedChanges = true;
            broadcastSaveStatus(room, {
              type: 'save_status',
              status: 'saving',
              pageId,
            });

            scheduleSave(pageId, doc)
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

        // Broadcast awareness updates to other authenticated room clients
        awareness.on('update', ({ added, updated, removed }, origin) => {
          const changedClients = added.concat(updated).concat(removed);
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
          encoding.writeVarUint8Array(
            encoder,
            awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients)
          );
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

  // HTTP Server (Health check + Upgrade routing)
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname === '/health' || url.pathname === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          uptime: process.uptime(),
          roomsCount: rooms.size,
          rooms: Array.from(rooms.keys()),
        })
      );
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
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

    // Validate role authorization: Only OWNER and EDITOR allowed
    if (payload.role !== 'OWNER' && payload.role !== 'EDITOR') {
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
          const replyEncoder = encoding.createEncoder();
          encoding.writeVarUint(replyEncoder, MESSAGE_SYNC);
          syncProtocol.readSyncMessage(decoder, replyEncoder, room.doc, ws);
          if (encoding.length(replyEncoder) > 1) {
            ws.send(encoding.toUint8Array(replyEncoder), { binary: true });
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
            if (room.hasUnsavedChanges || hasPendingSave(pageId)) {
              await flushSave(pageId, room.doc);
              console.log(`[CollabServer] Successfully flushed state for room "${pageId}" before disposal.`);
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
  function start() {
    return new Promise((resolve, reject) => {
      const onListening = () => {
        const boundHost = host || 'dual-stack (0.0.0.0 / ::)';
        console.log(`[CollabServer] Yjs WebSocket server listening on port ${port} (${boundHost})`);
        console.log(`[CollabServer] Allowed Origins: ${allowedOrigins.join(', ')}`);
        console.log(`[CollabServer] Auth Timeout: ${authTimeoutMs}ms | Cleanup Grace: ${cleanupGraceMs}ms`);
        resolve({ server, port, host });
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

    // 2. Disconnect active clients gracefully
    for (const room of rooms.values()) {
      for (const client of room.clients) {
        try {
          client.close(1001, 'Server shutting down');
        } catch {}
      }
    }

    // 3. Flush all active rooms with unsaved edits to PostgreSQL in parallel
    const flushPromises = [];
    for (const [pageId, room] of rooms.entries()) {
      if (room.hasUnsavedChanges || hasPendingSave(pageId)) {
        flushPromises.push(
          flushSave(pageId, room.doc)
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

    // 4. Destroy room CRDTs
    for (const room of rooms.values()) {
      try {
        room.isDestroyed = true;
        room.awareness.destroy();
        room.doc.destroy();
      } catch {}
    }
    rooms.clear();

    // 5. Close WebSocket server and HTTP server
    await new Promise((resolve) => {
      wss.close(() => {
        server.close(resolve);
      });
    });

    // 6. Close persistence pool if requested
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
