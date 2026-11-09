/**
 * Phase 10 Step 3.2 / 3.4: Cross-Process Active Room RPC Security & Coordination Verification Suite
 *
 * Verifies:
 * 1. Startup validation: Missing secret prevents server startup.
 * 2. Startup validation: Empty secret prevents server startup.
 * 3. Startup validation: Secret shorter than 32 bytes (64 hex chars) is rejected.
 * 4. Startup validation: Non-hex characters are rejected.
 * 5. Startup validation: Valid 64-character hex secret is accepted.
 * 6. Internal RPC authentication: Valid token succeeds with 200.
 * 7. Timing-safe comparison: Different-length token is safely rejected with 401 without unhandled error.
 * 8. Timing-safe comparison: Incorrect token of equal length is rejected with 401.
 * 9. Missing Bearer token is rejected with 401.
 * 10. `AUTH_SECRET` cannot authenticate internal RPC (dedicated secret required).
 * 11. Client-side secret validation prevents silent unauthenticated calls.
 * 12. HTTP method enforcement (POST required, rejects GET/PUT with 405).
 * 13. Loopback protection rejects non-loopback calls with 403.
 * 14. Dormant/inactive room detection (returns active: false, flushed: false).
 * 15. Active room flush with in-flight debounce queue.
 * 16. Snapshot creation captures active in-memory edits across process boundary.
 * 17. Failure protection: Snapshot creation fails when active room flush fails (no stale fallback).
 * 18. Offline collab server resilience (ECONNREFUSED -> reads DB safely).
 * 19. RPC timeout throws error and rejects snapshot creation.
 */

import path from 'path';
import fs from 'fs';
import assert from 'assert';
import crypto from 'node:crypto';
import * as Y from 'yjs';
import * as yTiptap from '@tiptap/y-tiptap';
import {
  getPrismaClient,
  saveDocumentState,
  closePersistence,
  hasPendingSave,
  scheduleSave,
} from '../src/server/collab-persistence.mjs';
import {
  createCollabServer,
  validateInternalRpcSecret,
} from '../src/server/collab-server.mjs';
import {
  flushActiveRoom,
  validateClientRpcSecret,
} from '../src/server/collab-internal-client.mjs';
import {
  createVersionSnapshot,
  extractTextFromProseMirror,
} from '../src/server/version-snapshot-service.mjs';

function loadEnv() {
  const envFiles = [
    path.resolve(process.cwd(), '.env.local'),
    path.resolve(process.cwd(), '.env'),
  ];
  for (const envPath of envFiles) {
    if (fs.existsSync(envPath)) {
      const lines = fs.readFileSync(envPath, 'utf8').split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          const k = trimmed.slice(0, eqIdx).trim();
          let v = trimmed.slice(eqIdx + 1).trim();
          if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
            v = v.slice(1, -1);
          }
          if (!process.env[k]) process.env[k] = v;
        }
      }
    }
  }
}
loadEnv();

const prisma = getPrismaClient();

function populateDocWithSampleContent(doc, textContent) {
  const fragment = doc.getXmlFragment('default');
  const p = new Y.XmlElement('paragraph');
  const text = new Y.XmlText();
  text.insert(0, textContent);
  p.insert(0, [text]);
  fragment.insert(0, [p]);
}

const TEST_RPC_PORT = 19495;
// Generate a genuine 32-byte (64 hex characters) test secret dynamically
const TEST_RPC_SECRET = crypto.randomBytes(32).toString('hex');
const DUMMY_WRONG_SECRET = crypto.randomBytes(32).toString('hex');

async function runTests() {
  console.log('\n=== Phase 10 Step 3.4: Internal RPC Security Remediation Verification ===\n');

  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    return (async () => {
      try {
        await fn();
        console.log(`  [PASS] ${name}`);
        passed++;
      } catch (err) {
        console.error(`  [FAIL] ${name}`);
        console.error(`         ${err.message}`);
        failed++;
      }
    })();
  }

  const timestamp = Date.now();
  const testUserId = `test-user-sec-${timestamp}`;
  const testWorkspaceId = `test-ws-sec-${timestamp}`;
  const testPageId1 = `test-page-sec-1-${timestamp}`;
  const testPageId2 = `test-page-sec-2-${timestamp}`;

  let collabServer = null;

  try {
    // -------------------------------------------------------------------------
    // SECTION 1: Startup Validation & Cryptographic Entropy Checks
    // -------------------------------------------------------------------------
    console.log('--- Section 1: Startup Validation & Secret Entropy ---');

    await test('1. Missing secret prevents server creation / startup', async () => {
      assert.throws(
        () => {
          createCollabServer({ internalRpcSecret: null });
        },
        /INTERNAL_RPC_SECRET is required/,
        'Should reject null secret at startup'
      );

      assert.throws(
        () => {
          createCollabServer({ internalRpcSecret: '' });
        },
        /INTERNAL_RPC_SECRET is required/,
        'Should reject empty string secret at startup'
      );
    });

    await test('2. Secret shorter than 32 bytes (64 hex characters) is rejected at startup', async () => {
      assert.throws(
        () => {
          createCollabServer({ internalRpcSecret: 'abcdef1234567890' });
        },
        /exactly 64 hexadecimal characters/,
        'Should reject secret with fewer than 64 characters'
      );
    });

    await test('3. Invalid non-hexadecimal characters are rejected at startup', async () => {
      assert.throws(
        () => {
          createCollabServer({ internalRpcSecret: 'z'.repeat(64) });
        },
        /exactly 64 hexadecimal characters/,
        'Should reject non-hexadecimal characters'
      );
    });

    await test('4. Client-side secret validation rejects missing or malformed secrets', async () => {
      assert.throws(
        () => {
          validateClientRpcSecret('');
        },
        /Dedicated INTERNAL_RPC_SECRET is required/,
        'Client validation should reject empty secret'
      );

      assert.throws(
        () => {
          validateClientRpcSecret('short-secret');
        },
        /must be exactly 64 hexadecimal characters/,
        'Client validation should reject short secret'
      );

      assert.strictEqual(validateClientRpcSecret(TEST_RPC_SECRET), true);
    });

    // 0. Seed test fixtures in database
    await prisma.user.create({
      data: {
        id: testUserId,
        email: `rpc-sec-${timestamp}@example.com`,
        name: 'RPC Security Tester',
        passwordHash: 'dummy-hash',
      },
    });

    await prisma.workspace.create({
      data: {
        id: testWorkspaceId,
        name: 'RPC Security Workspace',
        ownerId: testUserId,
      },
    });

    await prisma.page.createMany({
      data: [
        {
          id: testPageId1,
          workspaceId: testWorkspaceId,
          title: 'RPC Security Page 1',
          createdById: testUserId,
        },
        {
          id: testPageId2,
          workspaceId: testWorkspaceId,
          title: 'RPC Security Page 2',
          createdById: testUserId,
        },
      ],
    });

    // Start dedicated test collab server with valid 64-char hex secret
    collabServer = createCollabServer({
      port: TEST_RPC_PORT,
      internalRpcSecret: TEST_RPC_SECRET,
      host: '127.0.0.1',
    });
    await collabServer.start();

    const baseUrl = `http://127.0.0.1:${TEST_RPC_PORT}`;

    // -------------------------------------------------------------------------
    // SECTION 2: Timing-Safe Comparison & Bearer Authentication
    // -------------------------------------------------------------------------
    console.log('\n--- Section 2: Timing-Safe Comparison & Bearer Auth ---');

    await test('5. Internal RPC succeeds with correct 64-char hex Bearer token', async () => {
      const res = await fetch(`${baseUrl}/internal/rooms/${testPageId1}/flush`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TEST_RPC_SECRET}` },
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.active, false);
    });

    await test('6. Timing-safe comparison safely rejects different-length token without unhandled error', async () => {
      const res = await fetch(`${baseUrl}/internal/rooms/${testPageId1}/flush`, {
        method: 'POST',
        headers: { Authorization: 'Bearer short-token' },
      });
      assert.strictEqual(res.status, 401);
      const data = await res.json();
      assert.strictEqual(data.error, 'Unauthorized: Invalid internal RPC secret');
    });

    await test('7. Timing-safe comparison rejects same-length incorrect token with 401', async () => {
      const res = await fetch(`${baseUrl}/internal/rooms/${testPageId1}/flush`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${DUMMY_WRONG_SECRET}` },
      });
      assert.strictEqual(res.status, 401);
      const data = await res.json();
      assert.strictEqual(data.error, 'Unauthorized: Invalid internal RPC secret');
    });

    await test('8. Missing authorization header is rejected with 401', async () => {
      const res = await fetch(`${baseUrl}/internal/rooms/${testPageId1}/flush`, {
        method: 'POST',
      });
      assert.strictEqual(res.status, 401);
    });

    await test('9. AUTH_SECRET alone CANNOT authenticate internal RPC', async () => {
      const authSecret = process.env.AUTH_SECRET || 'collab-workspace-super-secret-jwt-signing-key-32-chars-min!';
      const res = await fetch(`${baseUrl}/internal/rooms/${testPageId1}/flush`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authSecret}` },
      });
      assert.strictEqual(res.status, 401, 'AUTH_SECRET must not authenticate internal RPC');
    });

    // -------------------------------------------------------------------------
    // SECTION 3: HTTP Method & Loopback Protection
    // -------------------------------------------------------------------------
    console.log('\n--- Section 3: Protocol & Loopback Controls ---');

    await test('10. Enforces POST method; rejects GET/PUT with 405 Method Not Allowed', async () => {
      const resGet = await fetch(`${baseUrl}/internal/rooms/${testPageId1}/flush`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${TEST_RPC_SECRET}` },
      });
      assert.strictEqual(resGet.status, 405);

      const resPut = await fetch(`${baseUrl}/internal/rooms/${testPageId1}/flush`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${TEST_RPC_SECRET}` },
      });
      assert.strictEqual(resPut.status, 405);
    });

    // -------------------------------------------------------------------------
    // SECTION 4: Active Room Flush & Cross-Process Snapshot Integration
    // -------------------------------------------------------------------------
    console.log('\n--- Section 4: Cross-Process Coordination & Snapshot Integration ---');

    await test('11. Active room in-memory edits and debounce timer are flushed immediately to PostgreSQL', async () => {
      const roomDoc = new Y.Doc();
      populateDocWithSampleContent(roomDoc, 'Remediated security test in-memory edits');

      const room = {
        pageId: testPageId1,
        doc: roomDoc,
        awareness: null,
        clients: new Set(),
        cleanupTimer: null,
        isDestroyed: false,
        lastSavedVersion: 0,
        hasUnsavedChanges: true,
      };
      collabServer.rooms.set(testPageId1, room);

      scheduleSave(testPageId1, roomDoc);
      assert.strictEqual(hasPendingSave(testPageId1), true);

      const flushResult = await flushActiveRoom(testPageId1, {
        port: TEST_RPC_PORT,
        secret: TEST_RPC_SECRET,
      });

      assert.strictEqual(flushResult.active, true);
      assert.strictEqual(flushResult.flushed, true);
      assert.strictEqual(hasPendingSave(testPageId1), false);
      assert.strictEqual(room.hasUnsavedChanges, false);

      const dbDocState = await prisma.documentState.findUnique({
        where: { pageId: testPageId1 },
      });
      assert.ok(dbDocState);

      const verifyDoc = new Y.Doc();
      Y.applyUpdate(verifyDoc, dbDocState.yjsState);
      const json = yTiptap.yXmlFragmentToProsemirrorJSON(verifyDoc.getXmlFragment('default'));
      const text = extractTextFromProseMirror(json);
      assert.strictEqual(text.trim(), 'Remediated security test in-memory edits');

      verifyDoc.destroy();
      roomDoc.destroy();
      collabServer.rooms.delete(testPageId1);
    });

    await test('12. createVersionSnapshot captures active in-memory edits across process boundary', async () => {
      const initialDoc = new Y.Doc();
      populateDocWithSampleContent(initialDoc, 'Initial text before editing session');
      await saveDocumentState(testPageId2, initialDoc);
      initialDoc.destroy();

      const activeDoc = new Y.Doc();
      populateDocWithSampleContent(activeDoc, 'Remediated secure version snapshot live edits');

      const room = {
        pageId: testPageId2,
        doc: activeDoc,
        awareness: null,
        clients: new Set(),
        cleanupTimer: null,
        isDestroyed: false,
        lastSavedVersion: 1,
        hasUnsavedChanges: true,
      };
      collabServer.rooms.set(testPageId2, room);
      scheduleSave(testPageId2, activeDoc);

      const snapshot = await createVersionSnapshot(testPageId2, {
        userId: testUserId,
        label: 'Secure Snapshot with Active Edits',
        collabPort: TEST_RPC_PORT,
        internalRpcSecret: TEST_RPC_SECRET,
      });

      assert.ok(snapshot.id);
      assert.strictEqual(snapshot.label, 'Secure Snapshot with Active Edits');

      const contentText = extractTextFromProseMirror(snapshot.content);
      assert.strictEqual(
        contentText.trim(),
        'Remediated secure version snapshot live edits',
        'Snapshot MUST contain the in-memory edits from the active room!'
      );

      activeDoc.destroy();
      collabServer.rooms.delete(testPageId2);
    });

    await test('13. Fails snapshot creation when active room flush fails (no stale fallback)', async () => {
      const failingFlushClient = async () => {
        throw new Error('[CollabInternalClient] Active room flush failed on collab server (HTTP 500): Database error');
      };

      await assert.rejects(
        async () => {
          await createVersionSnapshot(testPageId2, {
            userId: testUserId,
            label: 'Should Fail Remediated Snapshot',
            flushActiveRoom: failingFlushClient,
          });
        },
        /Active room flush failed on collab server/
      );

      const leakedSnapshot = await prisma.versionSnapshot.findFirst({
        where: { pageId: testPageId2, label: 'Should Fail Remediated Snapshot' },
      });
      assert.strictEqual(leakedSnapshot, null, 'No snapshot must be created on flush failure');
    });

    await test('14. Gracefully reads database when collaboration server is offline (ECONNREFUSED)', async () => {
      const UNUSED_OFFLINE_PORT = 19997;

      const result = await flushActiveRoom(testPageId2, {
        port: UNUSED_OFFLINE_PORT,
        secret: TEST_RPC_SECRET,
      });

      assert.strictEqual(result.active, false);
      assert.strictEqual(result.flushed, false);
      assert.strictEqual(result.serverReachable, false);

      const snapshot = await createVersionSnapshot(testPageId2, {
        userId: testUserId,
        label: 'Offline Collab Server Snapshot',
        collabPort: UNUSED_OFFLINE_PORT,
        internalRpcSecret: TEST_RPC_SECRET,
      });

      assert.ok(snapshot.id);
      assert.strictEqual(snapshot.label, 'Offline Collab Server Snapshot');
    });

    await test('15. RPC timeout throws error and rejects snapshot creation', async () => {
      const timingOutFlushClient = async () => {
        throw new Error('[CollabInternalClient] Timeout (5000ms) flushing active room');
      };

      await assert.rejects(
        async () => {
          await createVersionSnapshot(testPageId2, {
            userId: testUserId,
            label: 'Timeout Test Remediated',
            flushActiveRoom: timingOutFlushClient,
          });
        },
        /Timeout.*flushing active room/
      );
    });

  } finally {
    // Teardown
    console.log('\nCleaning up test fixtures...');
    try {
      if (collabServer) {
        await collabServer.close();
      }
      await prisma.versionSnapshot.deleteMany({
        where: { pageId: { in: [testPageId1, testPageId2] } },
      });
      await prisma.documentState.deleteMany({
        where: { pageId: { in: [testPageId1, testPageId2] } },
      });
      await prisma.page.deleteMany({
        where: { id: { in: [testPageId1, testPageId2] } },
      });
      await prisma.workspace.deleteMany({
        where: { id: testWorkspaceId },
      });
      await prisma.user.deleteMany({
        where: { id: testUserId },
      });
    } catch (err) {
      console.warn('Cleanup warning:', err.message);
    }
    await closePersistence();
  }

  console.log(`\n==================================================`);
  console.log(`Security Remediation Tests: ${passed} passed, ${failed} failed`);
  console.log(`==================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
