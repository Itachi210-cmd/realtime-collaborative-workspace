/**
 * Verification Suite: WebSocket Origin Validation & Collaboration Handshake
 *
 * Verifies that:
 * 1. The configured production origin (https://collab-workspace-h7od.onrender.com) is accepted.
 * 2. Origin normalization handles trailing slashes properly.
 * 3. Local development origins (http://localhost:3000) are accepted.
 * 4. Untrusted origins (https://attacker.com) are rejected with 403 Forbidden.
 * 5. Reverse-proxy forwarded headers from local ingress are validated against authorized hosts.
 * 6. Spoofed forwarded headers for unauthorized domains are rejected.
 * 7. Authentication token exchange and sync step 1 succeed on authorized origin.
 * 8. Role enforcement (read-only restriction) remains intact.
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { SignJWT } from 'jose';
import { WebSocket } from 'ws';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import { createCollabServer } from '../src/server/collab-server.mjs';

const TEST_AUTH_SECRET = crypto.randomBytes(32).toString('base64url');
const TEST_RPC_SECRET = crypto.randomBytes(32).toString('hex');
const PRODUCTION_ORIGIN = 'https://collab-workspace-h7od.onrender.com';

async function createTestToken(pageId, role = 'EDITOR') {
  const key = new TextEncoder().encode(TEST_AUTH_SECRET);
  return await new SignJWT({
    userName: `Test User (${role})`,
    userColor: '#10b981',
    pageId,
    workspaceId: 'ws-test-upgrade',
    role,
    purpose: 'collaboration',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(`user-${role.toLowerCase()}-1`)
    .setIssuer('collab-workspace-auth')
    .setAudience('collab-workspace-yjs')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(key);
}

function probeUpgrade(port, path, headers) {
  return new Promise((resolve) => {
    const req = http.request(
      `http://127.0.0.1:${port}${path}`,
      {
        method: 'GET',
        headers: {
          Connection: 'Upgrade',
          Upgrade: 'websocket',
          'Sec-WebSocket-Version': '13',
          'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
          ...headers,
        },
      }
    );

    req.on('response', (res) => {
      resolve({ statusCode: res.statusCode, statusMessage: res.statusMessage });
    });

    req.on('upgrade', (res, socket) => {
      socket.destroy();
      resolve({ statusCode: 101, statusMessage: 'Switching Protocols' });
    });

    req.on('error', (err) => {
      resolve({ error: err.message });
    });

    req.end();
  });
}

async function run() {
  console.log('=== Running WebSocket Upgrade & Origin Verification Suite ===\n');

  // Set environment variables representing Render production deployment
  process.env.NEXT_PUBLIC_APP_URL = PRODUCTION_ORIGIN;
  process.env.COLLAB_ALLOWED_ORIGINS = PRODUCTION_ORIGIN;

  const server = createCollabServer({
    port: 0,
    host: '127.0.0.1',
    authSecret: TEST_AUTH_SECRET,
    internalRpcSecret: TEST_RPC_SECRET,
    enableRedis: false,
    loadDocumentState: async () => ({ yjsState: null, stateVersion: 0 }),
    prisma: {
      $queryRaw: async () => [{ '?column?': 1 }],
      page: {
        findUnique: async () => ({ id: 'page-audit-1', title: 'Audit Page', content: null }),
      },
      documentState: {
        findUnique: async () => null,
        upsert: async () => ({ stateVersion: 1 }),
      },
    },
  });

  await server.start();
  const addr = server.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : server.port;
  console.log(`Test CollabServer running on 127.0.0.1:${port}`);

  let passed = 0;
  let total = 0;

  async function check(name, fn) {
    total++;
    try {
      await fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`[FAIL] ${name}:`, err.message);
      throw err;
    }
  }

  try {
    // 1. Configured production origin is accepted
    await check('Accepts configured production origin (https://collab-workspace-h7od.onrender.com)', async () => {
      const res = await probeUpgrade(port, '/page-audit-1', {
        Origin: PRODUCTION_ORIGIN,
      });
      assert.equal(res.statusCode, 101, `Expected 101, got ${res.statusCode}`);
    });

    // 2. Production origin with trailing slash is accepted (normalized)
    await check('Accepts production origin with trailing slash (normalized)', async () => {
      const res = await probeUpgrade(port, '/page-audit-1', {
        Origin: `${PRODUCTION_ORIGIN}/`,
      });
      assert.equal(res.statusCode, 101, `Expected 101, got ${res.statusCode}`);
    });

    // 3. Localhost development origin is accepted
    await check('Accepts local development origin (http://localhost:3000)', async () => {
      const res = await probeUpgrade(port, '/page-audit-1', {
        Origin: 'http://localhost:3000',
      });
      assert.equal(res.statusCode, 101, `Expected 101, got ${res.statusCode}`);
    });

    // 4. Untrusted origin is rejected with 403 Forbidden
    await check('Rejects untrusted origin (https://attacker.evil.com) with 403 Forbidden', async () => {
      const res = await probeUpgrade(port, '/page-audit-1', {
        Origin: 'https://attacker.evil.com',
      });
      assert.equal(res.statusCode, 403, `Expected 403, got ${res.statusCode}`);
    });

    // 5. Spoofed forwarded host with untrusted origin is rejected
    await check('Rejects spoofed X-Forwarded-Host for unauthorized origin', async () => {
      const res = await probeUpgrade(port, '/page-audit-1', {
        Origin: 'https://attacker.evil.com',
        'X-Forwarded-Host': 'attacker.evil.com',
        'X-Forwarded-Proto': 'https',
      });
      assert.equal(res.statusCode, 403, `Expected 403, got ${res.statusCode}`);
    });

    // 6. Valid forwarded host from loopback proxy is accepted
    await check('Accepts valid forwarded host matching authorized host from loopback proxy', async () => {
      const res = await probeUpgrade(port, '/page-audit-1', {
        Origin: PRODUCTION_ORIGIN,
        'X-Forwarded-Host': 'collab-workspace-h7od.onrender.com',
        'X-Forwarded-Proto': 'https',
      });
      assert.equal(res.statusCode, 101, `Expected 101, got ${res.statusCode}`);
    });

    // 7. Full authentication handshake succeeds on authorized origin
    await check('Full client auth and Yjs sync handshake succeeds on production origin', async () => {
      const token = await createTestToken('page-audit-1', 'EDITOR');
      await new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/page-audit-1`, {
          headers: { Origin: PRODUCTION_ORIGIN },
        });

        const doc = new Y.Doc();
        const timeout = setTimeout(() => {
          ws.terminate();
          reject(new Error('Auth and sync handshake timed out'));
        }, 5000);

        ws.on('open', () => {
          // Send first-message auth JSON frame
          ws.send(JSON.stringify({ type: 'auth', token }));

          // Send Sync Step 1
          const enc = encoding.createEncoder();
          encoding.writeVarUint(enc, 0); // MESSAGE_SYNC
          syncProtocol.writeSyncStep1(enc, doc);
          ws.send(encoding.toUint8Array(enc));
        });

        let receivedAuthAck = false;
        let receivedSync = false;

        ws.on('message', (data, isBinary) => {
          if (!isBinary) {
            try {
              const msg = JSON.parse(data.toString());
              if (msg.type === 'authenticated' || msg.type === 'save_status') {
                receivedAuthAck = true;
              }
            } catch {}
          } else {
            const bytes = new Uint8Array(data);
            if (bytes.length > 0 && bytes[0] === 0) {
              receivedSync = true;
            }
          }

          if (receivedAuthAck && receivedSync) {
            clearTimeout(timeout);
            ws.close();
            doc.destroy();
            resolve();
          }
        });

        ws.on('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });
    });

    // 8. Missing token fails authentication with close code 4401
    await check('Unauthenticated connection is closed with code 4401', async () => {
      await new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/page-audit-1`, {
          headers: { Origin: PRODUCTION_ORIGIN },
        });

        const timeout = setTimeout(() => {
          ws.terminate();
          reject(new Error('Expected close 4401 but socket did not close'));
        }, 5000);

        ws.on('open', () => {
          // Send non-auth payload to trigger immediate rejection
          ws.send(JSON.stringify({ type: 'not_auth', data: 'hello' }));
        });

        ws.on('close', (code) => {
          clearTimeout(timeout);
          assert.equal(code, 4401, `Expected close code 4401, got ${code}`);
          resolve();
        });

        ws.on('error', () => {
          // Socket error during termination is expected
        });
      });
    });

    // 9. Read-only role (VIEWER) is blocked from submitting updates
    await check('Read-only role (VIEWER) cannot submit document updates', async () => {
      const viewerToken = await createTestToken('page-audit-1', 'VIEWER');
      await new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/page-audit-1`, {
          headers: { Origin: PRODUCTION_ORIGIN },
        });

        const timeout = setTimeout(() => {
          ws.terminate();
          reject(new Error('Permission denied check timed out'));
        }, 5000);

        ws.on('open', () => {
          // Authenticate
          ws.send(JSON.stringify({ type: 'auth', token: viewerToken }));

          // Attempt unauthorized Yjs update
          setTimeout(() => {
            const clientDoc = new Y.Doc();
            const text = clientDoc.getText('content');
            text.insert(0, 'Unauthorized edit');
            const updateBytes = Y.encodeStateAsUpdate(clientDoc);

            const enc = encoding.createEncoder();
            encoding.writeVarUint(enc, 0); // MESSAGE_SYNC
            encoding.writeVarUint(enc, 2); // messageYjsUpdate
            encoding.writeVarUint8Array(enc, updateBytes);
            ws.send(encoding.toUint8Array(enc));
          }, 150);
        });

        ws.on('message', (data, isBinary) => {
          if (!isBinary) {
            try {
              const msg = JSON.parse(data.toString());
              if (msg.type === 'permission_denied') {
                clearTimeout(timeout);
                ws.close();
                resolve();
              }
            } catch {}
          }
        });

        ws.on('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });
    });

  } finally {
    await server.close();
  }

  console.log(`\n==============================================`);
  console.log(`RESULTS: ${passed}/${total} upgrade verification tests passed.`);
  console.log(`==============================================\n`);
}

run().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
