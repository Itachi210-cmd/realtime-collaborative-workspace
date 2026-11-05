/**
 * Phase 6 Step 2: Automated Verification Test Suite
 * Secure Dedicated Yjs WebSocket Collaboration Server
 *
 * Verifies all 13 test requirements:
 * 1. Server starts on port 1234 and responds to /health
 * 2. Valid OWNER token connects and receives Sync Step 1
 * 3. Valid EDITOR token connects
 * 4. Invalid JWT signature is rejected with 4401/4403
 * 5. Expired JWT is rejected with 4401
 * 6. Missing auth within timeout triggers socket close (4401)
 * 7. Wrong pageId token is rejected with 4403
 * 8. VIEWER and COMMENTER tokens are rejected with 4403
 * 9. Untrusted Origin is rejected during upgrade with 403
 * 10. Unauthenticated socket attempting to send sync updates is blocked
 * 11. Two authenticated clients in the same room exchange and converge Yjs updates
 * 12. Clients in different rooms do not receive each other's updates
 * 13. Room cleanup timer triggers after all clients disconnect
 */

import { WebSocket } from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { SignJWT } from 'jose';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createCollabServer } from '../src/server/collab-server.mjs';

// Load .env.local if AUTH_SECRET is not in environment
function loadEnv() {
  if (process.env.AUTH_SECRET) return;
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq > 0) {
        const key = trimmed.slice(0, eq).trim();
        let val = trimmed.slice(eq + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) process.env[key] = val;
      }
    }
  }
}
loadEnv();

const AUTH_SECRET = process.env.AUTH_SECRET;
if (!AUTH_SECRET) {
  console.error('FATAL: AUTH_SECRET is not set in environment or .env.local');
  process.exit(1);
}

const TEST_PORT = 1234;
const SECRET_KEY = new TextEncoder().encode(AUTH_SECRET);
const ISSUER = 'collab-workspace-auth';
const AUDIENCE = 'collab-workspace-yjs';

// Token generation helper
async function generateTestToken({
  userId = 'test-user-1',
  userName = 'Test User',
  pageId = 'test-page-1',
  workspaceId = 'test-ws-1',
  role = 'OWNER',
  expiresIn = '60s',
  secretKey = SECRET_KEY,
  purpose = 'collaboration',
} = {}) {
  const jwt = new SignJWT({
    userName,
    pageId,
    workspaceId,
    role,
    purpose,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt();

  if (typeof expiresIn === 'number') {
    jwt.setExpirationTime(expiresIn);
  } else if (expiresIn) {
    jwt.setExpirationTime(expiresIn);
  }

  return jwt.sign(secretKey);
}

let passedTests = 0;
let totalTests = 13;

function logPass(num, title, details = '') {
  passedTests++;
  console.log(`[PASS] Test ${num}: ${title} ${details ? '(' + details + ')' : ''}`);
}

function logFail(num, title, error) {
  console.error(`[FAIL] Test ${num}: ${title}`);
  console.error(error);
}

// Client helper to setup a connected and authenticated WebSocket with a Y.Doc
function connectAuthenticatedClient({ pageId, token, doc }) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/${pageId}`);
    ws.binaryType = 'arraybuffer';

    let isAuthed = false;

    ws.on('open', () => {
      // Send first message authentication frame
      ws.send(JSON.stringify({ type: 'auth', token }));
    });

    ws.on('message', (data) => {
      if (typeof data === 'string') {
        try {
          const parsed = JSON.parse(data);
          if (parsed.type === 'authenticated') {
            isAuthed = true;
          }
        } catch {}
        return;
      }

      // Binary Yjs sync message
      try {
        const uint8 = new Uint8Array(data);
        const decoder = decoding.createDecoder(uint8);
        const msgType = decoding.readVarUint(decoder);

        if (msgType === 0) { // messageSync
          const replyEncoder = encoding.createEncoder();
          encoding.writeVarUint(replyEncoder, 0);
          syncProtocol.readSyncMessage(decoder, replyEncoder, doc, ws);
          if (encoding.length(replyEncoder) > 1) {
            ws.send(encoding.toUint8Array(replyEncoder));
          }
          if (!isAuthed) {
            isAuthed = true;
            resolve({ ws, doc });
          }
        }
      } catch (err) {
        console.error('Error handling client message:', err);
      }
    });

    ws.on('error', (err) => {
      if (!isAuthed) reject(err);
    });

    // Propagate local doc updates to the server
    doc.on('update', (update, origin) => {
      if (origin !== ws && ws.readyState === WebSocket.OPEN) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, 0); // messageSync
        syncProtocol.writeUpdate(encoder, update);
        ws.send(encoding.toUint8Array(encoder));
      }
    });

    // Timeout safety
    setTimeout(() => {
      if (!isAuthed) {
        ws.close();
        reject(new Error('Connection or authentication timed out'));
      }
    }, 4000);
  });
}

async function runTests() {
  console.log('='.repeat(70));
  console.log('Starting Phase 6 Step 2 Collaboration Server Verification Suite');
  console.log('='.repeat(70));

  // Check if a server is already running on port 1234, or start an internal instance
  let collabServer = null;
  const isServerRunning = await new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${TEST_PORT}/health`, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
  });

  if (!isServerRunning) {
    console.log(`Starting test collaboration server on port ${TEST_PORT}...`);
    collabServer = createCollabServer({
      port: TEST_PORT,
      host: '127.0.0.1',
      authTimeoutMs: 2000, // Shorter timeout for fast test execution
      cleanupGraceMs: 600,  // Fast cleanup timer for Test 13
    });
    await collabServer.start();
  } else {
    console.log(`Using existing server running on port ${TEST_PORT}`);
  }

  try {
    // -------------------------------------------------------------
    // Test 1: Server starts on port 1234
    // -------------------------------------------------------------
    try {
      const res = await new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${TEST_PORT}/health`, (resp) => {
          let body = '';
          resp.on('data', (chunk) => (body += chunk));
          resp.on('end', () => resolve({ statusCode: resp.statusCode, body: JSON.parse(body) }));
        }).on('error', reject);
      });

      if (res.statusCode === 200 && res.body.status === 'ok') {
        logPass(1, 'Server starts on port 1234 and responds to /health', `status: ${res.body.status}`);
      } else {
        throw new Error(`Unexpected health response: ${JSON.stringify(res)}`);
      }
    } catch (err) {
      logFail(1, 'Server starts on port 1234', err);
    }

    // -------------------------------------------------------------
    // Test 2: Valid OWNER token connects and receives Sync Step 1
    // -------------------------------------------------------------
    try {
      const pageId = 'page-test-owner';
      const token = await generateTestToken({ pageId, role: 'OWNER', userName: 'Owner User' });

      await new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/${pageId}`);
        ws.binaryType = 'arraybuffer';

        let receivedSyncStep1 = false;

        ws.on('open', () => {
          ws.send(JSON.stringify({ type: 'auth', token }));
        });

        ws.on('message', (data) => {
          if (typeof data !== 'string') {
            const uint8 = new Uint8Array(data);
            const decoder = decoding.createDecoder(uint8);
            const msgType = decoding.readVarUint(decoder);
            if (msgType === 0) { // messageSync
              const syncType = decoding.readVarUint(decoder);
              if (syncType === 0) { // messageYjsSyncStep1
                receivedSyncStep1 = true;
                ws.close();
                resolve();
              }
            }
          }
        });

        ws.on('error', reject);
        setTimeout(() => {
          if (!receivedSyncStep1) {
            ws.close();
            reject(new Error('Did not receive Sync Step 1 within timeout'));
          }
        }, 3000);
      });

      logPass(2, 'Valid OWNER token connects and receives Sync Step 1');
    } catch (err) {
      logFail(2, 'Valid OWNER token connects and receives Sync Step 1', err);
    }

    // -------------------------------------------------------------
    // Test 3: Valid EDITOR token connects
    // -------------------------------------------------------------
    try {
      const pageId = 'page-test-editor';
      const token = await generateTestToken({ pageId, role: 'EDITOR', userName: 'Editor User' });

      await new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/${pageId}`);
        ws.binaryType = 'arraybuffer';

        let authed = false;

        ws.on('open', () => {
          ws.send(JSON.stringify({ type: 'auth', token }));
        });

        ws.on('message', (data) => {
          if (typeof data === 'string') {
            const parsed = JSON.parse(data);
            if (parsed.type === 'authenticated' && parsed.user.role === 'EDITOR') {
              authed = true;
              ws.close();
              resolve();
            }
          } else {
            // Also accepted if binary sync step 1 arrives
            authed = true;
            ws.close();
            resolve();
          }
        });

        ws.on('error', reject);
        setTimeout(() => {
          if (!authed) {
            ws.close();
            reject(new Error('Editor authentication timed out'));
          }
        }, 3000);
      });

      logPass(3, 'Valid EDITOR token connects and authenticates successfully');
    } catch (err) {
      logFail(3, 'Valid EDITOR token connects', err);
    }

    // -------------------------------------------------------------
    // Test 4: Invalid JWT signature is rejected with 4401/4403
    // -------------------------------------------------------------
    try {
      const pageId = 'page-test-bad-sig';
      const bogusKey = new TextEncoder().encode('completely-wrong-bogus-secret-key-32-chars!');
      const badToken = await generateTestToken({ pageId, role: 'OWNER', secretKey: bogusKey });

      const closeCode = await new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/${pageId}`);
        ws.on('open', () => {
          ws.send(JSON.stringify({ type: 'auth', token: badToken }));
        });
        ws.on('close', (code) => resolve(code));
        ws.on('error', () => {}); // Expected error
        setTimeout(() => reject(new Error('Socket was not closed for invalid signature')), 3000);
      });

      if (closeCode === 4401 || closeCode === 4403) {
        logPass(4, 'Invalid JWT signature is rejected', `Close code: ${closeCode}`);
      } else {
        throw new Error(`Expected close code 4401 or 4403, received: ${closeCode}`);
      }
    } catch (err) {
      logFail(4, 'Invalid JWT signature is rejected', err);
    }

    // -------------------------------------------------------------
    // Test 5: Expired JWT is rejected
    // -------------------------------------------------------------
    try {
      const pageId = 'page-test-expired';
      const pastTimestamp = Math.floor(Date.now() / 1000) - 30; // 30 seconds ago
      const expiredToken = await generateTestToken({ pageId, role: 'OWNER', expiresIn: pastTimestamp });

      const closeCode = await new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/${pageId}`);
        ws.on('open', () => {
          ws.send(JSON.stringify({ type: 'auth', token: expiredToken }));
        });
        ws.on('close', (code) => resolve(code));
        ws.on('error', () => {});
        setTimeout(() => reject(new Error('Socket was not closed for expired token')), 3000);
      });

      if (closeCode === 4401 || closeCode === 4403) {
        logPass(5, 'Expired JWT is rejected', `Close code: ${closeCode}`);
      } else {
        throw new Error(`Expected close code 4401, received: ${closeCode}`);
      }
    } catch (err) {
      logFail(5, 'Expired JWT is rejected', err);
    }

    // -------------------------------------------------------------
    // Test 6: Missing auth within 5 seconds triggers socket close
    // -------------------------------------------------------------
    try {
      const pageId = 'page-test-timeout';
      const closeCode = await new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/${pageId}`);
        // Send nothing, wait for auth timeout
        ws.on('close', (code) => resolve(code));
        ws.on('error', () => {});
        setTimeout(() => reject(new Error('Socket did not timeout as expected')), 6000);
      });

      if (closeCode === 4401) {
        logPass(6, 'Missing auth within timeout triggers socket close', `Close code: ${closeCode}`);
      } else {
        throw new Error(`Expected close code 4401, received: ${closeCode}`);
      }
    } catch (err) {
      logFail(6, 'Missing auth within 5 seconds triggers socket close', err);
    }

    // -------------------------------------------------------------
    // Test 7: Wrong pageId token is rejected
    // -------------------------------------------------------------
    try {
      const requestedPageId = 'page-actual-room';
      const tokenPageId = 'page-different-room';
      const mismatchToken = await generateTestToken({ pageId: tokenPageId, role: 'OWNER' });

      const closeCode = await new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/${requestedPageId}`);
        ws.on('open', () => {
          ws.send(JSON.stringify({ type: 'auth', token: mismatchToken }));
        });
        ws.on('close', (code) => resolve(code));
        ws.on('error', () => {});
        setTimeout(() => reject(new Error('Socket was not closed for pageId mismatch')), 3000);
      });

      if (closeCode === 4403) {
        logPass(7, 'Wrong pageId token is rejected', `Close code: ${closeCode}`);
      } else {
        throw new Error(`Expected close code 4403, received: ${closeCode}`);
      }
    } catch (err) {
      logFail(7, 'Wrong pageId token is rejected', err);
    }

    // -------------------------------------------------------------
    // Test 8: Unauthorized roles (e.g. GUEST, ANONYMOUS) are rejected with 4403
    // (Phase 9 expands authorized roles to OWNER, EDITOR, COMMENTER, VIEWER)
    // -------------------------------------------------------------
    try {
      const pageIdGuest = 'page-role-guest';
      const guestToken = await generateTestToken({ pageId: pageIdGuest, role: 'GUEST' });
      const guestCloseCode = await new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/${pageIdGuest}`);
        ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token: guestToken })));
        ws.on('close', (code) => resolve(code));
        ws.on('error', () => {});
        setTimeout(() => reject(new Error('Guest connection not closed')), 3000);
      });

      const pageIdAnon = 'page-role-anon';
      const anonToken = await generateTestToken({ pageId: pageIdAnon, role: 'ANONYMOUS' });
      const anonCloseCode = await new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/${pageIdAnon}`);
        ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token: anonToken })));
        ws.on('close', (code) => resolve(code));
        ws.on('error', () => {});
        setTimeout(() => reject(new Error('Anonymous connection not closed')), 3000);
      });

      if (guestCloseCode === 4403 && anonCloseCode === 4403) {
        logPass(8, 'Unauthorized roles (GUEST, ANONYMOUS) are rejected with 4403', `Guest: ${guestCloseCode}, Anon: ${anonCloseCode}`);
      } else {
        throw new Error(`Expected 4403 for both, got Guest: ${guestCloseCode}, Anon: ${anonCloseCode}`);
      }
    } catch (err) {
      logFail(8, 'Unauthorized roles are rejected', err);
    }

    // -------------------------------------------------------------
    // Test 9: Untrusted Origin is rejected during upgrade with 403
    // -------------------------------------------------------------
    try {
      const pageId = 'page-test-origin';
      const status = await new Promise((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/${pageId}`, {
          headers: {
            Origin: 'http://malicious-untrusted-site.com',
          },
        });

        ws.on('unexpected-response', (req, res) => {
          resolve(res.statusCode);
        });

        ws.on('error', () => {});
        ws.on('open', () => resolve(200));
        setTimeout(() => resolve(0), 3000);
      });

      if (status === 403) {
        logPass(9, 'Untrusted Origin is rejected during upgrade with 403 Forbidden');
      } else {
        throw new Error(`Expected HTTP 403, received: ${status}`);
      }
    } catch (err) {
      logFail(9, 'Untrusted Origin is rejected during upgrade with 403', err);
    }

    // -------------------------------------------------------------
    // Test 10: Unauthenticated socket attempting to send sync updates is blocked
    // -------------------------------------------------------------
    try {
      const pageId = 'page-test-unauth-sync';
      const closeCode = await new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/${pageId}`);
        ws.binaryType = 'arraybuffer';

        ws.on('open', () => {
          // Attempt to bypass auth by sending a binary SyncStep1 message directly
          const dummyDoc = new Y.Doc();
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, 0); // messageSync
          syncProtocol.writeSyncStep1(encoder, dummyDoc);
          ws.send(encoding.toUint8Array(encoder));
        });

        ws.on('close', (code) => resolve(code));
        ws.on('error', () => {});
        setTimeout(() => reject(new Error('Unauthenticated sync attempt was not closed')), 3000);
      });

      if (closeCode === 4401) {
        logPass(10, 'Unauthenticated socket attempting to send sync updates is blocked', `Close code: ${closeCode}`);
      } else {
        throw new Error(`Expected close code 4401, received: ${closeCode}`);
      }
    } catch (err) {
      logFail(10, 'Unauthenticated socket attempting to send sync updates is blocked', err);
    }

    // -------------------------------------------------------------
    // Test 11: Two authenticated clients in the same room exchange and converge Yjs updates
    // -------------------------------------------------------------
    try {
      const pageId = 'room-sync-convergence-11';
      const token1 = await generateTestToken({ pageId, role: 'OWNER', userId: 'client-1', userName: 'Alice' });
      const token2 = await generateTestToken({ pageId, role: 'EDITOR', userId: 'client-2', userName: 'Bob' });

      const doc1 = new Y.Doc();
      const doc2 = new Y.Doc();

      const c1 = await connectAuthenticatedClient({ pageId, token: token1, doc: doc1 });
      const c2 = await connectAuthenticatedClient({ pageId, token: token2, doc: doc2 });

      // Alice types in Doc 1
      const testContent = 'Real-time collaborative editing with Yjs!';
      doc1.getText('editor-content').insert(0, testContent);

      // Wait for convergence in Doc 2
      await new Promise((resolve, reject) => {
        const check = () => {
          if (doc2.getText('editor-content').toString() === testContent) {
            resolve();
          }
        };

        doc2.on('update', check);
        setTimeout(check, 100);
        setTimeout(() => reject(new Error(`Convergence timeout. Doc 2 content: "${doc2.getText('editor-content').toString()}"`)), 4000);
      });

      c1.ws.close();
      c2.ws.close();

      logPass(11, 'Two authenticated clients in same room exchange and converge updates', `Content: "${testContent}"`);
    } catch (err) {
      logFail(11, 'Two authenticated clients in same room exchange and converge updates', err);
    }

    // -------------------------------------------------------------
    // Test 12: Clients in different rooms do not receive each other's updates
    // -------------------------------------------------------------
    try {
      const roomA = 'room-isolation-A';
      const roomB = 'room-isolation-B';

      const tokenA = await generateTestToken({ pageId: roomA, role: 'OWNER', userId: 'user-a' });
      const tokenB = await generateTestToken({ pageId: roomB, role: 'OWNER', userId: 'user-b' });

      const docA = new Y.Doc();
      const docB = new Y.Doc();

      const clientA = await connectAuthenticatedClient({ pageId: roomA, token: tokenA, doc: docA });
      const clientB = await connectAuthenticatedClient({ pageId: roomB, token: tokenB, doc: docB });

      // Insert secret text into Room A
      docA.getText('text').insert(0, 'Confidential Room A Data');

      // Wait 300ms to allow any potential leak
      await new Promise((r) => setTimeout(r, 300));

      // Verify Room B remained clean
      const roomBContent = docB.getText('text').toString();
      if (roomBContent !== '') {
        throw new Error(`Leak detected! Room B received: "${roomBContent}"`);
      }

      // Insert secret text into Room B
      docB.getText('text').insert(0, 'Confidential Room B Data');
      await new Promise((r) => setTimeout(r, 300));

      const roomAContent = docA.getText('text').toString();
      if (roomAContent !== 'Confidential Room A Data') {
        throw new Error(`Leak detected! Room A was modified: "${roomAContent}"`);
      }

      clientA.ws.close();
      clientB.ws.close();

      logPass(12, 'Clients in different rooms do not receive each other updates (Strict Room Isolation)');
    } catch (err) {
      logFail(12, 'Clients in different rooms do not receive each others updates', err);
    }

    // -------------------------------------------------------------
    // Test 13: Room cleanup timer triggers after all clients disconnect
    // -------------------------------------------------------------
    try {
      const pageId = 'room-cleanup-test-13';
      const token = await generateTestToken({ pageId, role: 'OWNER', userId: 'cleanup-user' });
      const doc = new Y.Doc();

      const client = await connectAuthenticatedClient({ pageId, token, doc });

      // Verify room is present in server memory
      let healthRes = await new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${TEST_PORT}/health`, (resp) => {
          let body = '';
          resp.on('data', (c) => (body += c));
          resp.on('end', () => resolve(JSON.parse(body)));
        }).on('error', reject);
      });

      if (!healthRes.rooms.includes(pageId)) {
        throw new Error(`Room ${pageId} not found in active rooms list prior to disconnect`);
      }

      // Disconnect client
      client.ws.close();

      // Wait for cleanup grace period + margin (grace period is 600ms in test server)
      await new Promise((r) => setTimeout(r, 1200));

      // Re-check health endpoint to ensure room was destroyed
      healthRes = await new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${TEST_PORT}/health`, (resp) => {
          let body = '';
          resp.on('data', (c) => (body += c));
          resp.on('end', () => resolve(JSON.parse(body)));
        }).on('error', reject);
      });

      if (healthRes.rooms.includes(pageId)) {
        throw new Error(`Room ${pageId} was not cleaned up after grace period`);
      }

      logPass(13, 'Room cleanup timer triggers after all clients disconnect (In-memory room destroyed)');
    } catch (err) {
      logFail(13, 'Room cleanup timer triggers after all clients disconnect', err);
    }

  } finally {
    if (collabServer) {
      console.log('Shutting down test collaboration server...');
      await collabServer.close();
    }
  }

  console.log('='.repeat(70));
  console.log(`Phase 6 Step 2 Verification Results: ${passedTests} / ${totalTests} Passed`);
  console.log('='.repeat(70));

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
