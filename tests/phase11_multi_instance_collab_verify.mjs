/**
 * Phase 11 Step 1: Multi-Instance Real-Time Collaboration Verification Suite
 *
 * Spawns two genuinely independent collaboration server instances (Instance A & Instance B),
 * connects them via Redis Pub/Sub, and tests cross-instance synchronization,
 * bidirectional editing, concurrent CRDT convergence, loop prevention,
 * role authorization, cross-instance restore, and PostgreSQL persistence.
 */

import { WebSocket } from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { SignJWT } from 'jose';
import path from 'path';
import fs from 'fs';
import { createCollabServer } from '../src/server/collab-server.mjs';
import { getPrismaClient, closePersistence } from '../src/server/collab-persistence.mjs';
import { restoreActiveRoom } from '../src/server/collab-internal-client.mjs';
import { createVersionSnapshot } from '../src/server/version-snapshot-service.mjs';

// Protocol Message Constants
const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

// Server Ports & Hosts
const PORT_A = 19472;
const PORT_B = 19473;
const HOST = '127.0.0.1';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Load secrets
function loadEnv() {
  if (process.env.AUTH_SECRET && process.env.INTERNAL_RPC_SECRET) return;
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq > 0) {
        const k = trimmed.substring(0, eq).trim();
        const v = trimmed.substring(eq + 1).trim().replace(/^['"]|['"]$/g, '');
        if (!process.env[k]) process.env[k] = v;
      }
    }
  }
}
loadEnv();

const AUTH_SECRET = process.env.AUTH_SECRET || 'collab-workspace-super-secret-jwt-signing-key-32-chars-min!';
const INTERNAL_RPC_SECRET =
  process.env.INTERNAL_RPC_SECRET || '3345a0b29ea35fa5f6fe1aa1f33dab66fb4566ec4175f90621d238016d425bf0';
const SECRET_KEY = new TextEncoder().encode(AUTH_SECRET);
const ISSUER = 'collab-workspace-auth';
const AUDIENCE = 'collab-workspace-yjs';

const prisma = getPrismaClient();

async function createToken({
  userId = 'usr-p11-test',
  userName = 'P11 Engineer',
  pageId,
  workspaceId = 'ws-p11-test',
  role = 'EDITOR',
  expiresIn = '120s',
} = {}) {
  return await new SignJWT({
    userName,
    pageId,
    workspaceId,
    role,
    purpose: 'collaboration',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(SECRET_KEY);
}

function connectClient({
  pageId,
  token,
  port,
  origin = 'http://localhost:3000',
  autoAuth = true,
}) {
  return new Promise((resolve, reject) => {
    const url = `ws://${HOST}:${port}/${pageId}`;
    const ws = new WebSocket(url, {
      headers: { Origin: origin },
    });

    const clientDoc = new Y.Doc();
    const clientAwareness = new awarenessProtocol.Awareness(clientDoc);
    const updatesReceived = [];
    let authenticated = false;
    let syncStep1Received = false;

    ws.on('open', () => {
      if (autoAuth && token) {
        ws.send(JSON.stringify({ token }));
      }
    });

    ws.on('error', (err) => {
      reject(err);
    });

    ws.on('message', (data, isBinary) => {
      if (!isBinary) {
        try {
          const json = JSON.parse(data.toString());
          if (json.type === 'authenticated') {
            authenticated = true;
            // Send client sync step 1
            const syncEncoder = encoding.createEncoder();
            encoding.writeVarUint(syncEncoder, MESSAGE_SYNC);
            syncProtocol.writeSyncStep1(syncEncoder, clientDoc);
            ws.send(encoding.toUint8Array(syncEncoder), { binary: true });
          }
        } catch {}
        return;
      }

      const decoder = decoding.createDecoder(new Uint8Array(data));
      const messageType = decoding.readVarUint(decoder);

      if (messageType === MESSAGE_SYNC) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        syncProtocol.readSyncMessage(decoder, encoder, clientDoc, ws);
        if (encoding.length(encoder) > 1) {
          ws.send(encoding.toUint8Array(encoder), { binary: true });
        }
        syncStep1Received = true;
        updatesReceived.push(data);
      } else if (messageType === MESSAGE_AWARENESS) {
        awarenessProtocol.applyAwarenessUpdate(
          clientAwareness,
          decoding.readVarUint8Array(decoder),
          ws
        );
      }
    });

    setTimeout(() => {
      resolve({
        ws,
        doc: clientDoc,
        awareness: clientAwareness,
        updatesReceived,
        isAuthenticated: () => authenticated,
        isSynced: () => syncStep1Received,
        sendUpdate: (updateBytes) => {
          const enc = encoding.createEncoder();
          encoding.writeVarUint(enc, MESSAGE_SYNC);
          syncProtocol.writeUpdate(enc, updateBytes);
          ws.send(encoding.toUint8Array(enc), { binary: true });
        },
      });
    }, 250);
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runSuite() {
  console.log('======================================================================');
  console.log('  Phase 11 Step 1: Multi-Instance Collaboration Verification Suite     ');
  console.log('======================================================================\n');

  let passed = 0;
  let failed = 0;

  function report(title, isOk, detail = '') {
    if (isOk) {
      console.log(`[PASS] ${title}${detail ? ` - ${detail}` : ''}`);
      passed++;
    } else {
      console.error(`[FAIL] ${title}${detail ? ` - ${detail}` : ''}`);
      failed++;
    }
  }

  let serverA = null;
  let serverB = null;
  const createdPageIds = [];
  let testWorkspace = null;
  let testUser = null;

  try {
    // 1. Setup Test Workspace & User in DB
    const timestamp = Date.now();
    testUser = await prisma.user.create({
      data: {
        email: `p11_user_${timestamp}@test.com`,
        name: 'Phase 11 User',
        passwordHash: 'testhash',
      },
    });

    testWorkspace = await prisma.workspace.create({
      data: {
        name: `P11 Workspace ${timestamp}`,
        ownerId: testUser.id,
      },
    });

    await prisma.workspaceMember.create({
      data: {
        workspaceId: testWorkspace.id,
        userId: testUser.id,
        role: 'OWNER',
      },
    });

    // 2. Start Server Instance A
    console.log('--- 1. Starting Server Instance A & Instance B ---');
    serverA = createCollabServer({
      port: PORT_A,
      host: HOST,
      instanceId: 'server-instance-A',
      redisUrl: REDIS_URL,
      cleanupGraceMs: 1000,
      authTimeoutMs: 3000,
      internalRpcSecret: INTERNAL_RPC_SECRET,
      allowedOrigins: ['http://localhost:3000'],
    });
    await serverA.start();

    // 3. Start Server Instance B
    serverB = createCollabServer({
      port: PORT_B,
      host: HOST,
      instanceId: 'server-instance-B',
      redisUrl: REDIS_URL,
      cleanupGraceMs: 1000,
      authTimeoutMs: 3000,
      internalRpcSecret: INTERNAL_RPC_SECRET,
      allowedOrigins: ['http://localhost:3000'],
    });
    await serverB.start();

    // Verify /health on both instances
    const healthARes = await fetch(`http://${HOST}:${PORT_A}/health`).then((r) => r.json());
    const healthBRes = await fetch(`http://${HOST}:${PORT_B}/health`).then((r) => r.json());

    report(
      'TC-P11-01: Both independent servers report health "ok" with Redis ready',
      healthARes.status === 'ok' &&
        healthBRes.status === 'ok' &&
        healthARes.redis?.status === 'ready' &&
        healthBRes.redis?.status === 'ready',
      `instA: ${healthARes.instanceId}, instB: ${healthBRes.instanceId}`
    );

    // Create shared test page
    const page1 = await prisma.page.create({
      data: {
        title: 'Multi-Instance Page 1',
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
      },
    });
    createdPageIds.push(page1.id);

    // --- 2. Client Connections to Separate Instances ---
    console.log('\n--- 2. Client A -> Instance A, Client B -> Instance B ---');
    const tokenA = await createToken({
      userId: testUser.id,
      pageId: page1.id,
      workspaceId: testWorkspace.id,
      role: 'EDITOR',
    });
    const tokenB = await createToken({
      userId: testUser.id,
      pageId: page1.id,
      workspaceId: testWorkspace.id,
      role: 'EDITOR',
    });

    const clientA = await connectClient({ pageId: page1.id, token: tokenA, port: PORT_A });
    const clientB = await connectClient({ pageId: page1.id, token: tokenB, port: PORT_B });

    report(
      'TC-P11-02: Both clients authenticated and connected to separate server instances',
      clientA.isAuthenticated() && clientB.isAuthenticated(),
      `Client A on port ${PORT_A}, Client B on port ${PORT_B}`
    );

    // --- 3. Forward Propagation: Instance A -> Instance B ---
    console.log('\n--- 3. Forward Propagation: Client A types on Instance A -> Client B receives on Instance B ---');
    clientA.doc.getText('default').insert(0, 'Hello from Instance A!');
    clientA.sendUpdate(Y.encodeStateAsUpdate(clientA.doc));

    // Await Redis publication and delivery to Instance B
    await sleep(300);

    const textOnB = clientB.doc.getText('default').toString();
    report(
      'TC-P11-03: Update on Instance A propagated across Redis to Client B on Instance B',
      textOnB === 'Hello from Instance A!',
      `Received on B: "${textOnB}"`
    );

    // --- 4. Reverse Propagation: Instance B -> Instance A (Bidirectional Sync) ---
    console.log('\n--- 4. Reverse Propagation: Client B types on Instance B -> Client A receives on Instance A ---');
    clientB.doc.getText('default').insert(clientB.doc.getText('default').length, ' And Hello from Instance B!');
    clientB.sendUpdate(Y.encodeStateAsUpdate(clientB.doc));

    await sleep(300);

    const textOnA = clientA.doc.getText('default').toString();
    const expectedCombined = 'Hello from Instance A! And Hello from Instance B!';
    report(
      'TC-P11-04: Bidirectional sync verified across instances',
      textOnA === expectedCombined && clientB.doc.getText('default').toString() === expectedCombined,
      `Text on A: "${textOnA}"`
    );

    // --- 5. Concurrent Edits & CRDT Convergence ---
    console.log('\n--- 5. Concurrent Edits on Both Instances -> Deterministic Convergence ---');
    // Simulate simultaneous edits at position 0 from both clients
    clientA.doc.getText('default').insert(0, '[A-edit] ');
    clientB.doc.getText('default').insert(0, '[B-edit] ');

    clientA.sendUpdate(Y.encodeStateAsUpdate(clientA.doc));
    clientB.sendUpdate(Y.encodeStateAsUpdate(clientB.doc));

    await sleep(400);

    const finalA = clientA.doc.getText('default').toString();
    const finalB = clientB.doc.getText('default').toString();

    report(
      'TC-P11-05: Concurrent edits converged deterministically to identical state on both instances',
      finalA === finalB && finalA.includes('[A-edit]') && finalA.includes('[B-edit]'),
      `Final converged text: "${finalA}"`
    );

    // --- 6. Infinite Loop Prevention ---
    console.log('\n--- 6. Infinite Loop Prevention Verification ---');
    // Instance A should not re-publish updates that originated from Redis
    const baselineUpdatesA = clientA.updatesReceived.length;
    clientB.doc.getText('default').insert(finalB.length, ' [Loop Test]');
    clientB.sendUpdate(Y.encodeStateAsUpdate(clientB.doc));

    await sleep(300);

    // Client A receives the single update from B; Instance A must NOT echo it back to B
    const baselineUpdatesB = clientB.updatesReceived.length;
    await sleep(300);

    report(
      'TC-P11-06: No infinite re-publishing loops detected; update count remained stable',
      clientB.updatesReceived.length === baselineUpdatesB,
      `Updates on B: ${clientB.updatesReceived.length}`
    );

    // --- 7. Page Channel Isolation ---
    console.log('\n--- 7. Page Channel Isolation Verification ---');
    const page2 = await prisma.page.create({
      data: {
        title: 'Isolated Page 2',
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
      },
    });
    createdPageIds.push(page2.id);

    const tokenPage2 = await createToken({
      userId: testUser.id,
      pageId: page2.id,
      workspaceId: testWorkspace.id,
      role: 'EDITOR',
    });
    const clientPage2 = await connectClient({ pageId: page2.id, token: tokenPage2, port: PORT_B });

    // Client A edits Page 1
    clientA.doc.getText('default').insert(0, 'Page1 Unique Edit ');
    clientA.sendUpdate(Y.encodeStateAsUpdate(clientA.doc));
    await sleep(250);

    const textPage2 = clientPage2.doc.getText('default').toString();
    report(
      'TC-P11-07: Updates on page1 did NOT leak to client on page2 across instances',
      textPage2 === '',
      `Page2 text: "${textPage2}"`
    );

    clientPage2.ws.close();

    // --- 8. Read-Only Protection Regression Across Instances ---
    console.log('\n--- 8. Read-Only (VIEWER) Permission Protection ---');
    const tokenViewer = await createToken({
      userId: testUser.id,
      pageId: page1.id,
      workspaceId: testWorkspace.id,
      role: 'VIEWER',
    });
    const clientViewer = await connectClient({ pageId: page1.id, token: tokenViewer, port: PORT_A });

    const textBeforeViewerEdit = clientB.doc.getText('default').toString();
    clientViewer.doc.getText('default').insert(0, 'MALICIOUS_VIEWER_EDIT ');
    clientViewer.sendUpdate(Y.encodeStateAsUpdate(clientViewer.doc));

    await sleep(300);

    const textAfterViewerEdit = clientB.doc.getText('default').toString();
    report(
      'TC-P11-08: VIEWER update was dropped by Instance A and NOT published to Instance B',
      textAfterViewerEdit === textBeforeViewerEdit && !textAfterViewerEdit.includes('MALICIOUS_VIEWER_EDIT'),
      `Instance B text preserved without unauthorized edit`
    );

    clientViewer.ws.close();

    // --- 9. PostgreSQL Persistence Compatibility ---
    console.log('\n--- 9. PostgreSQL Persistence Compatibility ---');
    // Allow debounce (1500ms) to trigger and persist to PostgreSQL
    console.log('Waiting for debounced persistence (1800ms)...');
    await sleep(1800);

    const savedDocState = await prisma.documentState.findUnique({
      where: { pageId: page1.id },
    });

    report(
      'TC-P11-09: Cross-instance edits persisted to PostgreSQL DocumentState with stateVersion > 0',
      savedDocState !== null && savedDocState.stateVersion > 0,
      `stateVersion: ${savedDocState?.stateVersion}, bytes: ${savedDocState?.yjsState?.length}`
    );

    if (savedDocState) {
      const persistedDoc = new Y.Doc();
      Y.applyUpdate(persistedDoc, new Uint8Array(savedDocState.yjsState));
      const persistedText = persistedDoc.getText('default').toString();
      report(
        'TC-P11-10: Persisted Yjs BYTEA state decodes and matches convergent document state',
        persistedText === clientA.doc.getText('default').toString(),
        `Persisted: "${persistedText.substring(0, 35)}..."`
      );
    }

    // --- 10. Cross-Instance Restore Coordination ---
    console.log('\n--- 10. Cross-Instance Document Restore Coordination ---');
    const pageRestore = await prisma.page.create({
      data: {
        title: 'Restore Multi-Instance Page',
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
      },
    });
    createdPageIds.push(pageRestore.id);

    const tokenResA = await createToken({ userId: testUser.id, pageId: pageRestore.id, workspaceId: testWorkspace.id });
    const tokenResB = await createToken({ userId: testUser.id, pageId: pageRestore.id, workspaceId: testWorkspace.id });

    const clientResA = await connectClient({ pageId: pageRestore.id, token: tokenResA, port: PORT_A });
    const clientResB = await connectClient({ pageId: pageRestore.id, token: tokenResB, port: PORT_B });

    // Initial edit on restore page using XmlFragment (standard TipTap fragment)
    const pNode = new Y.XmlElement('paragraph');
    pNode.insert(0, [new Y.XmlText('Initial Content Before Restore')]);
    clientResA.doc.getXmlFragment('default').insert(0, [pNode]);
    clientResA.sendUpdate(Y.encodeStateAsUpdate(clientResA.doc));
    await sleep(300);

    // Take a snapshot of a distinct target state
    const snapshotDoc = new Y.Doc();
    const pTarget = new Y.XmlElement('paragraph');
    pTarget.insert(0, [new Y.XmlText('Restored State Content')]);
    snapshotDoc.getXmlFragment('default').insert(0, [pTarget]);

    const testSnapshot = await createVersionSnapshot(pageRestore.id, {
      userId: testUser.id,
      label: 'Pre-Restore Snapshot',
      doc: snapshotDoc,
    });

    // Call restore on Instance A via internal RPC client
    const restoreResult = await restoreActiveRoom(pageRestore.id, {
      versionId: testSnapshot.id,
      userId: testUser.id,
      port: PORT_A,
      secret: INTERNAL_RPC_SECRET,
    });

    report('TC-P11-11: Restore RPC on Instance A succeeded', restoreResult.success, `restored: ${restoreResult.restoredVersionId}`);

    // Await cross-instance Redis restore update delivery to Instance B
    await sleep(400);

    const restoredXmlA = clientResA.doc.getXmlFragment('default').toString();
    const restoredXmlB = clientResB.doc.getXmlFragment('default').toString();

    report(
      'TC-P11-12: Restored document state propagated across Redis to Client B on Instance B without disconnection',
      restoredXmlA === restoredXmlB && restoredXmlB.includes('Restored State Content'),
      `Client A: "${restoredXmlA}", Client B: "${restoredXmlB}"`
    );

    // Clean up all clients
    clientA.ws.close();
    clientB.ws.close();
    clientResA.ws.close();
    clientResB.ws.close();
    await sleep(200);

    // --- 11. Room Cleanup & Redis Unsubscription ---
    console.log('\n--- 11. Room Disposal & Unsubscription ---');
    // Wait for cleanupGraceMs (1000ms) to trigger room destruction
    console.log('Waiting for room cleanup timer (1300ms)...');
    await sleep(1300);

    report(
      'TC-P11-13: Rooms destroyed and unregistered on both instances after cleanup grace period',
      serverA.rooms.size === 0 && serverB.rooms.size === 0,
      `roomsA: ${serverA.rooms.size}, roomsB: ${serverB.rooms.size}`
    );

  } catch (err) {
    console.error('Test suite error:', err);
    report('Unexpected test failure', false, err.message);
  } finally {
    // Shutdown servers
    console.log('\nShutting down Server Instance A & B...');
    if (serverA) await serverA.close();
    if (serverB) await serverB.close();

    // Clean up database test records
    console.log('Cleaning up test database records...');
    try {
      for (const pid of createdPageIds) {
        await prisma.versionSnapshot.deleteMany({ where: { pageId: pid } });
        await prisma.documentState.deleteMany({ where: { pageId: pid } });
        await prisma.page.deleteMany({ where: { id: pid } });
      }
      if (testWorkspace) {
        await prisma.workspaceMember.deleteMany({ where: { workspaceId: testWorkspace.id } });
        await prisma.workspace.deleteMany({ where: { id: testWorkspace.id } });
      }
      if (testUser) {
        await prisma.user.deleteMany({ where: { id: testUser.id } });
      }
      console.log('Test database records cleaned up cleanly.');
    } catch (cleanErr) {
      console.warn('Error during DB cleanup:', cleanErr.message);
    }
    await closePersistence();
  }

  console.log('\n======================================================================');
  console.log(`TOTAL TESTS: ${passed + failed}`);
  console.log(`PASSED: ${passed}`);
  console.log(`FAILED: ${failed}`);
  console.log('======================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runSuite().catch((err) => {
  console.error('Fatal suite failure:', err);
  process.exit(1);
});
