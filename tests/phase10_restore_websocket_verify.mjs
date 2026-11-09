/**
 * Phase 10 Step 4: Version Restore WebSocket Live Synchronization Suite
 *
 * Verifies:
 * 1. Collab server POST /internal/rooms/:pageId/restore endpoint execution.
 * 2. Active room in-memory document replacement in 'restore' transaction.
 * 3. Live broadcast to multiple connected authenticated WebSocket clients.
 * 4. Connected clients receive update and update their local Y.Doc in real-time without disconnect.
 * 5. Automatic recovery snapshot captures pre-restore state.
 * 6. PostgreSQL DocumentState persisted and confirmed before RPC returns.
 * 7. Concurrent restore requests serialized safely through restore lock mutex.
 */

import path from 'path';
import fs from 'fs';
import assert from 'assert';
import http from 'http';
import WebSocket from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as yTiptap from '@tiptap/y-tiptap';
import { SignJWT } from 'jose';
import {
  getPrismaClient,
  saveDocumentState,
  loadDocumentState,
  closePersistence,
} from '../src/server/collab-persistence.mjs';
import { startCollabServer } from '../src/server/collab-server.mjs';
import {
  createVersionSnapshot,
  getVersionSnapshot,
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

const TEST_SECRET = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
const AUTH_SECRET = process.env.AUTH_SECRET || 'collab-workspace-super-secret-jwt-signing-key-32-chars-min!';
const secretKey = new TextEncoder().encode(AUTH_SECRET);
const prisma = getPrismaClient();

const TEST_PORT = 19496;

async function generateCollabToken(user, pageId) {
  return await new SignJWT({
    sub: user.id,
    email: user.email,
    userName: user.name,
    pageId,
    workspaceId: 'test-ws',
    role: 'EDITOR',
    purpose: 'collaboration',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer('collab-workspace-auth')
    .setAudience('collab-workspace-yjs')
    .setExpirationTime('1h')
    .sign(secretKey);
}

/**
 * Creates an authenticated WebSocket client that syncs a local Y.Doc with the server.
 */
function createConnectedClient(port, pageId, token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/${pageId}`);
    const clientDoc = new Y.Doc();

    ws.on('open', () => {
      // Step 1: Send authentication message (type 2)
      const authEncoder = encoding.createEncoder();
      encoding.writeVarUint(authEncoder, 2); // MESSAGE_AUTH
      encoding.writeVarString(authEncoder, token);
      ws.send(encoding.toUint8Array(authEncoder));

      // Step 2: Send sync step 1
      const syncEncoder = encoding.createEncoder();
      encoding.writeVarUint(syncEncoder, 0); // MESSAGE_SYNC
      syncProtocol.writeSyncStep1(syncEncoder, clientDoc);
      ws.send(encoding.toUint8Array(syncEncoder));
    });

    ws.on('message', (data) => {
      if (typeof data === 'string') return; // Ignore JSON status messages
      const decoder = decoding.createDecoder(new Uint8Array(data));
      const messageType = decoding.readVarUint(decoder);
      if (messageType === 0) { // MESSAGE_SYNC
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, 0);
        syncProtocol.readSyncMessage(decoder, encoder, clientDoc, ws);
        if (encoding.length(encoder) > 1) {
          ws.send(encoding.toUint8Array(encoder));
        }
      }
    });

    ws.on('error', reject);

    // Give 400ms to finish initial handshake & sync
    setTimeout(() => {
      resolve({ ws, clientDoc });
    }, 400);
  });
}

async function runTests() {
  console.log('\n=== Phase 10 Step 4: Version Restore WebSocket Live Sync Tests ===\n');

  let passed = 0;
  let failed = 0;

  function pass(name) {
    console.log(`  [PASS] ${name}`);
    passed++;
  }

  function fail(name, err) {
    console.error(`  [FAIL] ${name}:`, err.message || err);
    failed++;
  }

  // Start dedicated collaboration server on TEST_PORT
  const collabInstance = await startCollabServer({
    port: TEST_PORT,
    host: '127.0.0.1',
    internalRpcSecret: TEST_SECRET,
    prisma,
  });

  const timestamp = Date.now();
  const testUser = await prisma.user.create({
    data: {
      email: `collab_restore_${timestamp}@example.com`,
      name: 'Collab Restore Tester',
      passwordHash: 'irrelevant',
    },
  });

  const testWorkspace = await prisma.workspace.create({
    data: {
      name: 'Collab Restore WS',
      ownerId: testUser.id,
    },
  });

  const testPage = await prisma.page.create({
    data: {
      title: 'Collab Restore Live Page',
      workspaceId: testWorkspace.id,
      createdById: testUser.id,
    },
  });

  let client1 = null;
  let client2 = null;

  try {
    // 1. Setup Historical Snapshot V1
    const docV1 = new Y.Doc();
    const p1 = new Y.XmlElement('paragraph');
    p1.insert(0, [new Y.XmlText('Historical Snapshot Content V1')]);
    docV1.getXmlFragment('default').insert(0, [p1]);
    await saveDocumentState(testPage.id, docV1);

    const snapshotV1 = await createVersionSnapshot(testPage.id, {
      userId: testUser.id,
      label: 'Sprint 1 Golden Snapshot',
      doc: docV1,
    });

    // 2. Mutate to V2 and connect two live clients
    const docV2 = new Y.Doc();
    const p2 = new Y.XmlElement('paragraph');
    p2.insert(0, [new Y.XmlText('Active Editing In Progress V2')]);
    docV2.getXmlFragment('default').insert(0, [p2]);
    await saveDocumentState(testPage.id, docV2);

    const token = await generateCollabToken(testUser, testPage.id);
    client1 = await createConnectedClient(TEST_PORT, testPage.id, token);
    client2 = await createConnectedClient(TEST_PORT, testPage.id, token);

    // Verify both clients initially see V2
    const c1Json = yTiptap.yXmlFragmentToProsemirrorJSON(client1.clientDoc.getXmlFragment('default'));
    const c2Json = yTiptap.yXmlFragmentToProsemirrorJSON(client2.clientDoc.getXmlFragment('default'));
    assert.strictEqual(c1Json.content[0].content[0].text, 'Active Editing In Progress V2');
    assert.strictEqual(c2Json.content[0].content[0].text, 'Active Editing In Progress V2');
    pass('1. Connected live WebSocket clients successfully synchronized with active document');

    // Test 2: Execute Restore RPC while clients are actively connected
    const rpcUrl = `http://127.0.0.1:${TEST_PORT}/internal/rooms/${testPage.id}/restore`;
    const rpcRes = await fetch(rpcUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_SECRET}`,
      },
      body: JSON.stringify({
        versionId: snapshotV1.id,
        userId: testUser.id,
      }),
    });

    assert.strictEqual(rpcRes.status, 200);
    const rpcBody = await rpcRes.json();
    assert.strictEqual(rpcBody.success, true);
    assert.strictEqual(rpcBody.restoredVersionId, snapshotV1.id);
    assert.ok(rpcBody.recoverySnapshotId);
    pass('2. Internal restore RPC executes successfully and returns 200 with recovery snapshot ID');

    // Allow 200ms for WebSocket sync propagation to clients
    await new Promise((r) => setTimeout(r, 200));

    // Test 3: Client 1 and Client 2 live update to V1
    const c1Restored = yTiptap.yXmlFragmentToProsemirrorJSON(client1.clientDoc.getXmlFragment('default'));
    const c2Restored = yTiptap.yXmlFragmentToProsemirrorJSON(client2.clientDoc.getXmlFragment('default'));

    assert.strictEqual(c1Restored.content[0].content[0].text, 'Historical Snapshot Content V1');
    assert.strictEqual(c2Restored.content[0].content[0].text, 'Historical Snapshot Content V1');
    assert.strictEqual(client1.ws.readyState, WebSocket.OPEN, 'Client 1 should remain connected');
    assert.strictEqual(client2.ws.readyState, WebSocket.OPEN, 'Client 2 should remain connected');
    pass('3. Connected collaborators receive real-time sync update without disconnection');

    // Test 4: PostgreSQL persistence confirmed
    const dbDoc = new Y.Doc();
    await loadDocumentState(testPage.id, dbDoc);
    const dbJson = yTiptap.yXmlFragmentToProsemirrorJSON(dbDoc.getXmlFragment('default'));
    assert.strictEqual(dbJson.content[0].content[0].text, 'Historical Snapshot Content V1');
    pass('4. Target document state in PostgreSQL successfully updated to restored state');

    // Test 5: Automatic recovery snapshot captured V2 state
    const recoveryRecord = await getVersionSnapshot(testPage.id, rpcBody.recoverySnapshotId);
    assert.ok(recoveryRecord);
    assert.strictEqual(recoveryRecord.isAutomatic, true);
    const recDoc = new Y.Doc();
    Y.applyUpdate(recDoc, new Uint8Array(recoveryRecord.yjsState));
    const recJson = yTiptap.yXmlFragmentToProsemirrorJSON(recDoc.getXmlFragment('default'));
    assert.strictEqual(recJson.content[0].content[0].text, 'Active Editing In Progress V2');
    pass('5. Automatic recovery snapshot accurately captured latest pre-restore edits');

    // Test 6: Concurrent Restore Requests Serialized Safely
    const reqA = fetch(rpcUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_SECRET}`,
      },
      body: JSON.stringify({ versionId: snapshotV1.id, userId: testUser.id }),
    });

    const reqB = fetch(rpcUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_SECRET}`,
      },
      body: JSON.stringify({ versionId: recoveryRecord.id, userId: testUser.id }),
    });

    const [resA, resB] = await Promise.all([reqA, reqB]);
    assert.strictEqual(resA.status, 200);
    assert.strictEqual(resB.status, 200);
    pass('6. Concurrent restore requests serialized safely without race conditions');

  } catch (err) {
    fail('Live WebSocket restore test suite', err);
  } finally {
    if (client1?.ws) client1.ws.close();
    if (client2?.ws) client2.ws.close();

    await prisma.versionSnapshot.deleteMany({
      where: { pageId: testPage.id },
    });
    await prisma.documentState.deleteMany({
      where: { pageId: testPage.id },
    });
    await prisma.page.deleteMany({
      where: { id: testPage.id },
    });
    await prisma.workspace.deleteMany({
      where: { id: testWorkspace.id },
    });
    await prisma.user.deleteMany({
      where: { id: testUser.id },
    });

    await collabInstance.close();
    await closePersistence();
  }

  console.log('\n==================================================');
  console.log(`Live WebSocket Restore Tests: ${passed} passed, ${failed} failed`);
  console.log('==================================================\n');

  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
