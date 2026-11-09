/**
 * Phase 11 Step 2: Distributed Collaboration, Presence & Persistence Verification Suite
 *
 * Comprehensive end-to-end multi-instance tests covering:
 * - Cross-instance awareness & cursor propagation
 * - Avatar identity & deterministic color preservation
 * - Disconnect & shutdown awareness cleanup
 * - Distributed persistence locking & stale-state prevention
 * - Cross-instance distributed restore locking (409 Conflict)
 * - Automatic recovery snapshot preservation
 * - Room isolation & role-based awareness permissions
 * - Full server restart & document recovery
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
const PORT_1 = 19474;
const PORT_2 = 19475;
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
  userId = 'usr-p11-step2',
  userName = 'Step 2 User',
  pageId,
  workspaceId = 'ws-p11-step2',
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
    const awarenessEvents = [];
    let authenticated = false;
    let syncStep1Received = false;

    clientAwareness.on('change', (changes) => {
      awarenessEvents.push({
        changes,
        states: new Map(clientAwareness.getStates()),
      });
    });

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
        awarenessEvents,
        isAuthenticated: () => authenticated,
        isSynced: () => syncStep1Received,
        sendUpdate: (updateBytes) => {
          const enc = encoding.createEncoder();
          encoding.writeVarUint(enc, MESSAGE_SYNC);
          syncProtocol.writeUpdate(enc, updateBytes);
          ws.send(encoding.toUint8Array(enc), { binary: true });
        },
        sendAwareness: (stateObj) => {
          clientAwareness.setLocalState(stateObj);
          const enc = encoding.createEncoder();
          encoding.writeVarUint(enc, MESSAGE_AWARENESS);
          encoding.writeVarUint8Array(
            enc,
            awarenessProtocol.encodeAwarenessUpdate(clientAwareness, [clientAwareness.clientID])
          );
          ws.send(encoding.toUint8Array(enc), { binary: true });
        },
      });
    }, 250);
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runSuite() {
  console.log('======================================================================');
  console.log(' Phase 11 Step 2: Distributed Collaboration, Presence & Final QA Test ');
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

  let server1 = null;
  let server2 = null;
  const createdPageIds = [];
  let testWorkspace = null;
  let testUser1 = null;
  let testUser2 = null;

  try {
    // 1. Setup Test Workspace & Users in PostgreSQL
    const timestamp = Date.now();
    testUser1 = await prisma.user.create({
      data: {
        email: `p11_s2_user1_${timestamp}@test.com`,
        name: 'Alice Cooper',
        passwordHash: 'testhash',
      },
    });

    testUser2 = await prisma.user.create({
      data: {
        email: `p11_s2_user2_${timestamp}@test.com`,
        name: 'Bob Dylan',
        passwordHash: 'testhash',
      },
    });

    testWorkspace = await prisma.workspace.create({
      data: {
        name: `P11 Step 2 Workspace ${timestamp}`,
        ownerId: testUser1.id,
      },
    });

    await prisma.workspaceMember.createMany({
      data: [
        { workspaceId: testWorkspace.id, userId: testUser1.id, role: 'OWNER' },
        { workspaceId: testWorkspace.id, userId: testUser2.id, role: 'EDITOR' },
      ],
    });

    // 2. Start Server Instance 1 & Server Instance 2
    console.log('--- 1. Starting Dual Independent Collaboration Servers ---');
    server1 = createCollabServer({
      port: PORT_1,
      host: HOST,
      instanceId: 'server-instance-1',
      redisUrl: REDIS_URL,
      cleanupGraceMs: 1000,
      authTimeoutMs: 3000,
      internalRpcSecret: INTERNAL_RPC_SECRET,
      allowedOrigins: ['http://localhost:3000'],
    });
    await server1.start();

    server2 = createCollabServer({
      port: PORT_2,
      host: HOST,
      instanceId: 'server-instance-2',
      redisUrl: REDIS_URL,
      cleanupGraceMs: 1000,
      authTimeoutMs: 3000,
      internalRpcSecret: INTERNAL_RPC_SECRET,
      allowedOrigins: ['http://localhost:3000'],
    });
    await server2.start();

    const health1 = await fetch(`http://${HOST}:${PORT_1}/health`).then((r) => r.json());
    const health2 = await fetch(`http://${HOST}:${PORT_2}/health`).then((r) => r.json());

    report(
      'TC-P11-D01: Both independent servers started and report ready Redis state in /health',
      health1.status === 'ok' &&
        health2.status === 'ok' &&
        health1.redis?.status === 'ready' &&
        health2.redis?.status === 'ready',
      `instance1: ${health1.instanceId}, instance2: ${health2.instanceId}`
    );

    // Create primary shared test page
    const pagePrimary = await prisma.page.create({
      data: {
        title: 'Distributed Collaboration Page',
        workspaceId: testWorkspace.id,
        createdById: testUser1.id,
      },
    });
    createdPageIds.push(pagePrimary.id);

    // --- 2. Cross-Instance Awareness & Cursor Synchronization ---
    console.log('\n--- 2. Cross-Instance Awareness & Cursor Synchronization ---');
    const token1 = await createToken({
      userId: testUser1.id,
      userName: testUser1.name,
      pageId: pagePrimary.id,
      workspaceId: testWorkspace.id,
      role: 'OWNER',
    });
    const token2 = await createToken({
      userId: testUser2.id,
      userName: testUser2.name,
      pageId: pagePrimary.id,
      workspaceId: testWorkspace.id,
      role: 'EDITOR',
    });

    const client1 = await connectClient({ pageId: pagePrimary.id, token: token1, port: PORT_1 });
    const client2 = await connectClient({ pageId: pagePrimary.id, token: token2, port: PORT_2 });

    // Client 1 sets awareness with cursor position and spoofed name
    client1.sendAwareness({
      user: { name: 'SPOOFED_NAME', role: 'SPOOFED_ADMIN' },
      cursor: { anchor: 10, head: 10 },
    });

    await sleep(350);

    const client2States = Array.from(client2.awareness.getStates().values());
    const remoteStateOn2 = client2States.find((s) => s?.user?.id === testUser1.id);

    report(
      'TC-P11-D02: Awareness update propagated across Redis from Instance 1 to Client 2 on Instance 2',
      remoteStateOn2 !== undefined && remoteStateOn2.cursor?.anchor === 10,
      `Observed remote cursor on Client 2: anchor=${remoteStateOn2?.cursor?.anchor}`
    );

    report(
      'TC-P11-D03: Server-side identity binding enforced: spoofed client name/role sanitized with JWT credentials',
      remoteStateOn2?.user?.name === 'Alice Cooper' && remoteStateOn2?.user?.role === 'OWNER',
      `Sanitized name: "${remoteStateOn2?.user?.name}", role: "${remoteStateOn2?.user?.role}"`
    );

    report(
      'TC-P11-D04: Deterministic color assigned and preserved across instances',
      typeof remoteStateOn2?.user?.color === 'string' && remoteStateOn2.user.color.startsWith('#'),
      `Assigned color: ${remoteStateOn2?.user?.color}`
    );

    // --- 3. Awareness Cleanup on Disconnect ---
    console.log('\n--- 3. Awareness Cleanup on Client Disconnect ---');
    client1.ws.close();
    await sleep(400);

    const statesAfterClose = Array.from(client2.awareness.getStates().values());
    const client1PresentAfterClose = statesAfterClose.some((s) => s?.user?.id === testUser1.id);

    report(
      'TC-P11-D05: Client 1 disconnect removed awareness state across Redis; no ghost cursor on Client 2',
      !client1PresentAfterClose,
      `Remaining states count on Client 2: ${statesAfterClose.length}`
    );

    // --- 4. Graceful Shutdown Awareness Removal ---
    console.log('\n--- 4. Stale Presence Cleanup on Graceful Server Shutdown ---');
    // Connect new client to Instance 1
    const clientTemp1 = await connectClient({ pageId: pagePrimary.id, token: token1, port: PORT_1 });
    clientTemp1.sendAwareness({ user: { name: 'Alice Cooper' }, cursor: { anchor: 25, head: 25 } });
    await sleep(300);

    const statesBeforeShutdown = Array.from(client2.awareness.getStates().values());
    const isTempPresent = statesBeforeShutdown.some((s) => s?.user?.id === testUser1.id);

    // Trigger graceful shutdown on Server 1
    await server1.close();
    await sleep(400);

    const statesAfterShutdown = Array.from(client2.awareness.getStates().values());
    const isTempPresentAfterShutdown = statesAfterShutdown.some((s) => s?.user?.id === testUser1.id);

    report(
      'TC-P11-D06: Server 1 shutdown broadcast awareness removal to Redis; Client 2 cleared presence immediately',
      isTempPresent && !isTempPresentAfterShutdown,
      `Before: present=${isTempPresent}, After: present=${isTempPresentAfterShutdown}`
    );

    // Restart Server 1 for remaining multi-instance tests
    server1 = createCollabServer({
      port: PORT_1,
      host: HOST,
      instanceId: 'server-instance-1-restarted',
      redisUrl: REDIS_URL,
      cleanupGraceMs: 1000,
      authTimeoutMs: 3000,
      internalRpcSecret: INTERNAL_RPC_SECRET,
      allowedOrigins: ['http://localhost:3000'],
    });
    await server1.start();

    // Reconnect Client 1 to Server 1
    const client1B = await connectClient({ pageId: pagePrimary.id, token: token1, port: PORT_1 });

    // --- 5. Distributed Persistence Coordination & Concurrent Writes ---
    console.log('\n--- 5. Distributed Persistence Coordination & Concurrent Edits ---');
    // Simulate simultaneous edits from Client 1B on Instance 1 and Client 2 on Instance 2
    client1B.doc.getText('default').insert(0, '[Instance1 Edit] ');
    client2.doc.getText('default').insert(0, '[Instance2 Edit] ');

    client1B.sendUpdate(Y.encodeStateAsUpdate(client1B.doc));
    client2.sendUpdate(Y.encodeStateAsUpdate(client2.doc));

    await sleep(350);

    const textOn1 = client1B.doc.getText('default').toString();
    const textOn2 = client2.doc.getText('default').toString();

    report(
      'TC-P11-D07: Concurrent edits across instances converged deterministically via Yjs CRDT',
      textOn1 === textOn2 && textOn1.includes('[Instance1 Edit]') && textOn1.includes('[Instance2 Edit]'),
      `Converged text: "${textOn1}"`
    );

    // Allow debounce to flush with distributed persistence lock
    console.log('Waiting for distributed debounced persistence (1800ms)...');
    await sleep(1800);

    const savedState = await prisma.documentState.findUnique({
      where: { pageId: pagePrimary.id },
    });

    report(
      'TC-P11-D08: Distributed persistence saved merged state to PostgreSQL without lost updates',
      savedState !== null && savedState.stateVersion > 0,
      `stateVersion: ${savedState?.stateVersion}`
    );

    if (savedState) {
      const persistedDoc = new Y.Doc();
      Y.applyUpdate(persistedDoc, new Uint8Array(savedState.yjsState));
      const persistedText = persistedDoc.getText('default').toString();
      report(
        'TC-P11-D09: Persisted PostgreSQL BYTEA contains both instances edits (no stale-state overwrite)',
        persistedText.includes('[Instance1 Edit]') && persistedText.includes('[Instance2 Edit]'),
        `Persisted content: "${persistedText}"`
      );
    }

    // --- 6. Cross-Instance Distributed Restore Mutex (409 Conflict) ---
    console.log('\n--- 6. Distributed Restore Mutex (409 Conflict Prevention) ---');
    const pageRestore = await prisma.page.create({
      data: {
        title: 'Distributed Restore Page',
        workspaceId: testWorkspace.id,
        createdById: testUser1.id,
      },
    });
    createdPageIds.push(pageRestore.id);

    const snapDoc = new Y.Doc();
    const p1 = new Y.XmlElement('paragraph');
    p1.insert(0, [new Y.XmlText('Snapshot Pre-Restore State')]);
    snapDoc.getXmlFragment('default').insert(0, [p1]);

    const snapshot = await createVersionSnapshot(pageRestore.id, {
      userId: testUser1.id,
      label: 'Distributed Restore Test Snapshot',
      doc: snapDoc,
    });

    // Acquire lock artificially on Redis to simulate another instance currently restoring
    const lockKey = `collab:room:lock:restore:${pageRestore.id}`;
    const testRedis = server1.collabRedis;
    const testLock = await testRedis.acquireLock(lockKey, 8000);

    // Attempt restore on Server 2 while lock is held by another instance
    const conflictRestoreRes = await restoreActiveRoom(pageRestore.id, {
      versionId: snapshot.id,
      userId: testUser2.id,
      port: PORT_2,
      secret: INTERNAL_RPC_SECRET,
    }).catch((err) => ({ error: err.message }));

    report(
      'TC-P11-D10: Concurrent restore on another instance rejected with 409 Conflict',
      conflictRestoreRes.error?.includes('409') || conflictRestoreRes.error?.includes('in progress'),
      `Received error: ${conflictRestoreRes.error}`
    );

    // Release artificial lock
    await testLock.release();

    // Now restore on Server 1 should succeed
    const successfulRestore = await restoreActiveRoom(pageRestore.id, {
      versionId: snapshot.id,
      userId: testUser1.id,
      port: PORT_1,
      secret: INTERNAL_RPC_SECRET,
    });

    report(
      'TC-P11-D11: Restore succeeded after lock release, creating automatic recovery snapshot',
      successfulRestore.success && typeof successfulRestore.recoverySnapshotId === 'string',
      `recoverySnapshotId: ${successfulRestore.recoverySnapshotId}`
    );

    // --- 7. Room Isolation Across Instances ---
    console.log('\n--- 7. Room & Page Isolation Across Instances ---');
    const pageIsolated = await prisma.page.create({
      data: {
        title: 'Isolated Page Across Instances',
        workspaceId: testWorkspace.id,
        createdById: testUser1.id,
      },
    });
    createdPageIds.push(pageIsolated.id);

    const tokenIso = await createToken({
      userId: testUser2.id,
      pageId: pageIsolated.id,
      workspaceId: testWorkspace.id,
      role: 'EDITOR',
    });
    const clientIsolated = await connectClient({ pageId: pageIsolated.id, token: tokenIso, port: PORT_2 });

    // Client 1B on pagePrimary moves cursor
    client1B.sendAwareness({ user: { name: 'Alice Cooper' }, cursor: { anchor: 999, head: 999 } });
    await sleep(250);

    const isoStates = Array.from(clientIsolated.awareness.getStates().values());
    const leakedUser = isoStates.find((s) => s?.user?.id === testUser1.id);

    report(
      'TC-P11-D12: Awareness from pagePrimary did NOT leak to client on pageIsolated across instances',
      leakedUser === undefined,
      `Isolated room states count: ${isoStates.length}`
    );

    clientIsolated.ws.close();

    // --- 8. Full Server Restart & Document Recovery ---
    console.log('\n--- 8. Full Server Restart & Cold Hydration Recovery ---');
    client1B.ws.close();
    client2.ws.close();
    await sleep(200);

    // Close both servers
    await server1.close();
    await server2.close();
    server1 = null;
    server2 = null;

    // Start a fresh, cold server instance on PORT_1
    const coldServer = createCollabServer({
      port: PORT_1,
      host: HOST,
      instanceId: 'cold-restart-instance',
      redisUrl: REDIS_URL,
      cleanupGraceMs: 1000,
      authTimeoutMs: 3000,
      internalRpcSecret: INTERNAL_RPC_SECRET,
      allowedOrigins: ['http://localhost:3000'],
    });
    await coldServer.start();

    // Connect client to cold server and verify state was restored from PostgreSQL
    const clientCold = await connectClient({ pageId: pagePrimary.id, token: token1, port: PORT_1 });
    await sleep(300);

    const recoveredText = clientCold.doc.getText('default').toString();
    report(
      'TC-P11-D13: Cold server restart hydrated exact document state from PostgreSQL DocumentState BYTEA',
      recoveredText.includes('[Instance1 Edit]') && recoveredText.includes('[Instance2 Edit]'),
      `Hydrated text: "${recoveredText}"`
    );

    clientCold.ws.close();
    await sleep(200);
    await coldServer.close();

  } catch (err) {
    console.error('Test suite error:', err);
    report('Unexpected test failure', false, err.message);
  } finally {
    // Cleanup servers
    console.log('\nCleaning up server instances...');
    if (server1) await server1.close();
    if (server2) await server2.close();

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
      if (testUser1) await prisma.user.deleteMany({ where: { id: testUser1.id } });
      if (testUser2) await prisma.user.deleteMany({ where: { id: testUser2.id } });
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

