/**
 * Phase 8 Step 3: WebSocket Server Persistence Integration Verification Suite
 * Real-Time Collaborative Workspace
 *
 * Verifies all 12 core requirements:
 * 1. Existing persisted document hydrates before client sync
 * 2. New documents initialize correctly
 * 3. Simultaneous connections share one hydrated room
 * 4. Document edits trigger debounced persistence
 * 5. Initial hydration does not cause unnecessary duplicate saves
 * 6. Awareness identity spoofing is sanitized using verified JWT claims
 * 7. Cursor and selection data survive sanitization
 * 8. Room cleanup flushes pending state before destruction
 * 9. Reconnection cancels cleanup correctly
 * 10. Graceful shutdown flushes all active rooms
 * 11. Database failures do not cause false success (proper rejection)
 * 12. Existing authentication, authorization, Origin and room isolation remain intact
 */

import { WebSocket } from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { SignJWT } from 'jose';
import path from 'node:path';
import fs from 'node:fs';
import { createCollabServer } from '../src/server/collab-server.mjs';
import {
  getPrismaClient,
  closePersistence,
  saveDocumentState,
} from '../src/server/collab-persistence.mjs';

// Protocol Message Constants
const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

// Load environment secrets
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
const SECRET_KEY = new TextEncoder().encode(AUTH_SECRET);
const ISSUER = 'collab-workspace-auth';
const AUDIENCE = 'collab-workspace-yjs';
const TEST_PORT = 19455;
const TEST_HOST = '127.0.0.1';

const prisma = getPrismaClient();

let passedCount = 0;
let failedCount = 0;

function report(testName, passed, detail = '') {
  if (passed) {
    console.log(`[PASS] ${testName}${detail ? ` - ${detail}` : ''}`);
    passedCount++;
  } else {
    console.error(`[FAIL] ${testName}${detail ? ` - ${detail}` : ''}`);
    failedCount++;
  }
}

// Token generation helper
async function generateTestToken({
  userId = 'user-test-1',
  userName = 'Test User',
  pageId = 'test-page-1',
  workspaceId = 'test-ws-1',
  role = 'EDITOR',
  expiresIn = '60s',
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

// Client connection helper
function connectClient({
  pageId,
  token,
  origin = 'http://localhost:3000',
  autoAuth = true,
}) {
  return new Promise((resolve) => {
    const url = `ws://${TEST_HOST}:${TEST_PORT}/${pageId}`;
    const ws = new WebSocket(url, {
      headers: { Origin: origin },
    });

    const clientDoc = new Y.Doc();
    const clientAwareness = new awarenessProtocol.Awareness(clientDoc);

    ws.on('open', () => {
      if (autoAuth && token) {
        ws.send(JSON.stringify({ token }));
      }
    });

    ws.on('error', () => {
      // Don't reject if caller expects connection to close
    });

    let authenticated = false;
    let syncReceived = false;

    ws.on('message', (data, isBinary) => {
      if (!isBinary) {
        try {
          const json = JSON.parse(data.toString());
          if (json.type === 'authenticated') {
            authenticated = true;
            // Send client's Sync Step 1 to request server's stored document updates
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
        syncReceived = true;
      } else if (messageType === MESSAGE_AWARENESS) {
        awarenessProtocol.applyAwarenessUpdate(
          clientAwareness,
          decoding.readVarUint8Array(decoder),
          ws
        );
      }
    });

    // Resolve helper once connection is established
    setTimeout(() => {
      resolve({
        ws,
        doc: clientDoc,
        awareness: clientAwareness,
        isAuthenticated: () => authenticated,
        hasReceivedSync: () => syncReceived,
      });
    }, 120);
  });
}

async function runSuite() {
  console.log('======================================================================');
  console.log('    Phase 8 Step 3: WebSocket Server Persistence Verification Suite    ');
  console.log('======================================================================\n');

  const createdPageIds = [];
  let testWorkspace = null;
  let testUser = null;
  let serverInstance = null;

  try {
    testUser = await prisma.user.findFirst();
    testWorkspace = await prisma.workspace.findFirst();
    if (!testUser || !testWorkspace) {
      throw new Error('Database missing test user or workspace');
    }

    // Start test collaboration server
    serverInstance = createCollabServer({
      port: TEST_PORT,
      host: TEST_HOST,
      cleanupGraceMs: 600, // Short cleanup grace for fast tests
      authTimeoutMs: 2000,
      allowedOrigins: ['http://localhost:3000', 'http://127.0.0.1:3000'],
    });
    await serverInstance.start();

    // ------------------------------------------------------------------------
    // Test 1: Existing Persisted Document Hydrates Before Client Sync
    // ------------------------------------------------------------------------
    console.log('--- Test 1: Persisted Document Hydration Before Sync ---');
    const pageHydrate = await prisma.page.create({
      data: {
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
        title: 'Hydration Test Page',
      },
    });
    createdPageIds.push(pageHydrate.id);

    // Pre-seed PostgreSQL DocumentState
    const seedDoc = new Y.Doc();
    const seedPara = new Y.XmlElement('paragraph');
    seedPara.insert(0, [new Y.XmlText('Pre-hydrated persistence text from PostgreSQL!')]);
    seedDoc.getXmlFragment('default').insert(0, [seedPara]);
    await saveDocumentState(pageHydrate.id, seedDoc);

    const token1 = await generateTestToken({
      userId: testUser.id,
      userName: testUser.name,
      pageId: pageHydrate.id,
      workspaceId: testWorkspace.id,
      role: 'EDITOR',
    });

    const client1 = await connectClient({ pageId: pageHydrate.id, token: token1 });

    // Wait for initial sync step exchange
    await new Promise((r) => setTimeout(r, 200));

    const hydratedText = client1.doc.getXmlFragment('default').get(0)?.get(0)?.toString();
    report(
      'Existing persisted document hydrates before client sync',
      hydratedText === 'Pre-hydrated persistence text from PostgreSQL!',
      `Hydrated text: "${hydratedText}"`
    );

    client1.ws.close();

    // ------------------------------------------------------------------------
    // Test 2: New Documents Initialize Correctly
    // ------------------------------------------------------------------------
    console.log('\n--- Test 2: New Document Initialization ---');
    const pageNew = await prisma.page.create({
      data: {
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
        title: 'New Document Page',
      },
    });
    createdPageIds.push(pageNew.id);

    const token2 = await generateTestToken({
      userId: testUser.id,
      userName: testUser.name,
      pageId: pageNew.id,
      workspaceId: testWorkspace.id,
      role: 'EDITOR',
    });

    const client2 = await connectClient({ pageId: pageNew.id, token: token2 });
    await new Promise((r) => setTimeout(r, 150));

    report(
      'New document initializes cleanly with empty Y.Doc',
      client2.isAuthenticated() && client2.hasReceivedSync() && client2.doc.getXmlFragment('default').length === 0,
      'Authenticated and synced with empty root'
    );
    client2.ws.close();

    // ------------------------------------------------------------------------
    // Test 3: Simultaneous Connections Share One Hydrated Room
    // ------------------------------------------------------------------------
    console.log('\n--- Test 3: Simultaneous Connection Deduplication ---');
    const pageSim = await prisma.page.create({
      data: {
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
        title: 'Simultaneous Hydration Page',
      },
    });
    createdPageIds.push(pageSim.id);

    const tokenSimA = await generateTestToken({
      userId: 'user-sim-a',
      userName: 'User Sim A',
      pageId: pageSim.id,
      workspaceId: testWorkspace.id,
      role: 'EDITOR',
    });
    const tokenSimB = await generateTestToken({
      userId: 'user-sim-b',
      userName: 'User Sim B',
      pageId: pageSim.id,
      workspaceId: testWorkspace.id,
      role: 'EDITOR',
    });

    // Launch simultaneous connections at the exact same millisecond
    const [clientSimA, clientSimB] = await Promise.all([
      connectClient({ pageId: pageSim.id, token: tokenSimA }),
      connectClient({ pageId: pageSim.id, token: tokenSimB }),
    ]);

    await new Promise((r) => setTimeout(r, 200));

    const simRoom = serverInstance.rooms.get(pageSim.id);
    report(
      'Simultaneous connections share a single hydrated room instance',
      simRoom !== undefined && simRoom.clients.size === 2,
      `Room clients count: ${simRoom?.clients?.size}`
    );

    clientSimA.ws.close();
    clientSimB.ws.close();

    // ------------------------------------------------------------------------
    // Test 4: Document Edits Trigger Debounced Persistence
    // ------------------------------------------------------------------------
    console.log('\n--- Test 4: Document Edits Trigger Debounced Persistence ---');
    const pageEdit = await prisma.page.create({
      data: {
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
        title: 'Debounce Edit Page',
      },
    });
    createdPageIds.push(pageEdit.id);

    const tokenEditA = await generateTestToken({
      userId: 'user-edit-a',
      userName: 'Alice',
      pageId: pageEdit.id,
      workspaceId: testWorkspace.id,
      role: 'EDITOR',
    });

    const clientEditA = await connectClient({ pageId: pageEdit.id, token: tokenEditA });
    await new Promise((r) => setTimeout(r, 150));

    // Client edits document
    clientEditA.doc.transact(() => {
      const p = new Y.XmlElement('paragraph');
      p.insert(0, [new Y.XmlText('Real-time persisted live edit')]);
      clientEditA.doc.getXmlFragment('default').insert(0, [p]);
    });

    // Send update frame to server
    const updateBytes = Y.encodeStateAsUpdate(clientEditA.doc);
    const updateEncoder = encoding.createEncoder();
    encoding.writeVarUint(updateEncoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(updateEncoder, updateBytes);
    clientEditA.ws.send(encoding.toUint8Array(updateEncoder), { binary: true });

    // Wait for debounced write interval (1500ms + buffer)
    console.log('Waiting 1800ms for debounced PostgreSQL write...');
    await new Promise((r) => setTimeout(r, 1800));

    const persistedRow = await prisma.documentState.findUnique({ where: { pageId: pageEdit.id } });
    report(
      'Document edits automatically persisted to PostgreSQL DocumentState',
      persistedRow !== null && persistedRow.yjsState.length > 0 && persistedRow.stateVersion >= 1,
      `Saved Version: ${persistedRow?.stateVersion}, Bytes: ${persistedRow?.yjsState?.length}`
    );

    // Verify preview dual-write in Page.content
    const updatedPageRow = await prisma.page.findUnique({ where: { id: pageEdit.id } });
    report(
      'Dual-write updated Page.content preview JSON in PostgreSQL',
      updatedPageRow?.content?.type === 'doc',
      `Preview type: ${updatedPageRow?.content?.type}`
    );

    clientEditA.ws.close();

    // ------------------------------------------------------------------------
    // Test 5: Initial Hydration Does Not Cause Unnecessary Duplicate Saves
    // ------------------------------------------------------------------------
    console.log('\n--- Test 5: Hydration Save Isolation ---');
    const versionBefore = persistedRow.stateVersion;

    // Connect second client to pageEdit without making any changes
    const tokenEditB = await generateTestToken({
      userId: 'user-edit-b',
      userName: 'Bob',
      pageId: pageEdit.id,
      workspaceId: testWorkspace.id,
      role: 'EDITOR',
    });

    const clientEditB = await connectClient({ pageId: pageEdit.id, token: tokenEditB });
    await new Promise((r) => setTimeout(r, 1800)); // wait full debounce duration

    const versionAfter = (await prisma.documentState.findUnique({ where: { pageId: pageEdit.id } })).stateVersion;
    report(
      'Initial hydration does not trigger unnecessary duplicate database writes',
      versionAfter === versionBefore,
      `Version remained: ${versionBefore}`
    );
    clientEditB.ws.close();

    // ------------------------------------------------------------------------
    // Test 6 & 7: Awareness Security & Cursor Preservation
    // ------------------------------------------------------------------------
    console.log('\n--- Test 6 & 7: Awareness Identity Sanitization & Cursor Survival ---');
    const pageAware = await prisma.page.create({
      data: {
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
        title: 'Awareness Sanitization Page',
      },
    });
    createdPageIds.push(pageAware.id);

    const tokenAttacker = await generateTestToken({
      userId: 'attacker-id-666',
      userName: 'Real Attacker Name',
      pageId: pageAware.id,
      workspaceId: testWorkspace.id,
      role: 'EDITOR',
    });

    const tokenObserver = await generateTestToken({
      userId: 'observer-id-777',
      userName: 'Observer Alice',
      pageId: pageAware.id,
      workspaceId: testWorkspace.id,
      role: 'EDITOR',
    });

    const clientAttacker = await connectClient({ pageId: pageAware.id, token: tokenAttacker });
    const clientObserver = await connectClient({ pageId: pageAware.id, token: tokenObserver });
    await new Promise((r) => setTimeout(r, 150));

    // Attacker sends awareness update with spoofed claims
    clientAttacker.awareness.setLocalState({
      user: {
        name: 'Spoofed Administrator',
        role: 'OWNER',
        id: 'spoofed-admin-id',
        color: '#e11d48',
      },
      cursor: { anchor: 14, head: 28 },
    });

    const rawAwarenessUpdate = awarenessProtocol.encodeAwarenessUpdate(
      clientAttacker.awareness,
      [clientAttacker.awareness.clientID]
    );

    const awEncoder = encoding.createEncoder();
    encoding.writeVarUint(awEncoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(awEncoder, rawAwarenessUpdate);
    clientAttacker.ws.send(encoding.toUint8Array(awEncoder), { binary: true });

    // Wait for broadcast to observer
    await new Promise((r) => setTimeout(r, 200));

    const receivedByObserver = clientObserver.awareness.getStates().get(clientAttacker.awareness.clientID);

    const nameSanitized = receivedByObserver?.user?.name === 'Real Attacker Name';
    const roleSanitized = receivedByObserver?.user?.role === 'EDITOR';
    const idSanitized = receivedByObserver?.user?.id === 'attacker-id-666';
    const cursorPreserved = receivedByObserver?.cursor?.anchor === 14 && receivedByObserver?.cursor?.head === 28;
    const colorPreserved = receivedByObserver?.user?.color === '#e11d48';

    report(
      'Awareness identity spoofing sanitized using verified JWT claims',
      nameSanitized && roleSanitized && idSanitized,
      `Sanitized name: "${receivedByObserver?.user?.name}", role: "${receivedByObserver?.user?.role}", id: "${receivedByObserver?.user?.id}"`
    );

    report(
      'Cursor position and color survive identity sanitization intact',
      cursorPreserved && colorPreserved,
      `Cursor: anchor=${receivedByObserver?.cursor?.anchor}, color=${receivedByObserver?.user?.color}`
    );

    clientAttacker.ws.close();
    clientObserver.ws.close();

    // ------------------------------------------------------------------------
    // Test 8: Room Cleanup Flushes Pending State Before Destruction
    // ------------------------------------------------------------------------
    console.log('\n--- Test 8: Room Cleanup Flush Before Disposal ---');
    const pageCleanup = await prisma.page.create({
      data: {
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
        title: 'Cleanup Flush Page',
      },
    });
    createdPageIds.push(pageCleanup.id);

    const tokenCleanup = await generateTestToken({
      userId: testUser.id,
      userName: testUser.name,
      pageId: pageCleanup.id,
      workspaceId: testWorkspace.id,
      role: 'EDITOR',
    });

    const clientCleanup = await connectClient({ pageId: pageCleanup.id, token: tokenCleanup });
    await new Promise((r) => setTimeout(r, 100));

    // Make an edit
    clientCleanup.doc.transact(() => {
      const p = new Y.XmlElement('paragraph');
      p.insert(0, [new Y.XmlText('Last-gasp edit before immediate disconnect')]);
      clientCleanup.doc.getXmlFragment('default').insert(0, [p]);
    });

    const clUpdate = Y.encodeStateAsUpdate(clientCleanup.doc);
    const clEncoder = encoding.createEncoder();
    encoding.writeVarUint(clEncoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(clEncoder, clUpdate);
    clientCleanup.ws.send(encoding.toUint8Array(clEncoder), { binary: true });

    // Disconnect IMMEDIATELY (before 1500ms debounce fires)
    clientCleanup.ws.close();

    // Wait for the room cleanup timer (600ms grace) to expire
    console.log('Waiting 1000ms for cleanup timer to flush and destroy room...');
    await new Promise((r) => setTimeout(r, 1000));

    // Check room destroyed
    const roomDestroyed = !serverInstance.rooms.has(pageCleanup.id);
    const cleanupSaved = await prisma.documentState.findUnique({ where: { pageId: pageCleanup.id } });

    report(
      'Room cleanup timer flushed pending state to PostgreSQL before room disposal',
      roomDestroyed && cleanupSaved !== null && cleanupSaved.yjsState.length > 0,
      `Room destroyed: ${roomDestroyed}, Saved bytes: ${cleanupSaved?.yjsState?.length}`
    );

    // ------------------------------------------------------------------------
    // Test 9: Reconnection Cancels Cleanup Correctly
    // ------------------------------------------------------------------------
    console.log('\n--- Test 9: Reconnection Cancels Cleanup ---');
    const pageRecon = await prisma.page.create({
      data: {
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
        title: 'Reconnection Page',
      },
    });
    createdPageIds.push(pageRecon.id);

    const tokenRecon = await generateTestToken({
      userId: testUser.id,
      userName: testUser.name,
      pageId: pageRecon.id,
      workspaceId: testWorkspace.id,
      role: 'EDITOR',
    });

    const clientRecon1 = await connectClient({ pageId: pageRecon.id, token: tokenRecon });
    await new Promise((r) => setTimeout(r, 100));
    clientRecon1.ws.close();

    // Allow disconnect event to reach server
    await new Promise((r) => setTimeout(r, 120));

    // Verify cleanup timer is active
    const reconRoom = serverInstance.rooms.get(pageRecon.id);
    const timerStarted = reconRoom && reconRoom.cleanupTimer !== null;

    // Reconnect before timer expires
    const clientRecon2 = await connectClient({ pageId: pageRecon.id, token: tokenRecon });
    await new Promise((r) => setTimeout(r, 100));

    const timerCancelled = reconRoom.cleanupTimer === null;
    report(
      'Client reconnection cancels pending room cleanup timer',
      timerStarted && timerCancelled && reconRoom.clients.size === 1,
      `Timer started then cancelled: ${timerCancelled}`
    );
    clientRecon2.ws.close();

    // ------------------------------------------------------------------------
    // Test 10: Graceful Shutdown Flushes All Active Rooms
    // ------------------------------------------------------------------------
    console.log('\n--- Test 10: Graceful Shutdown Flush ---');
    const pageShut = await prisma.page.create({
      data: {
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
        title: 'Shutdown Flush Page',
      },
    });
    createdPageIds.push(pageShut.id);

    const tokenShut = await generateTestToken({
      userId: testUser.id,
      userName: testUser.name,
      pageId: pageShut.id,
      workspaceId: testWorkspace.id,
      role: 'EDITOR',
    });

    const clientShut = await connectClient({ pageId: pageShut.id, token: tokenShut });
    await new Promise((r) => setTimeout(r, 100));

    clientShut.doc.transact(() => {
      const p = new Y.XmlElement('paragraph');
      p.insert(0, [new Y.XmlText('Content written right before SIGTERM')]);
      clientShut.doc.getXmlFragment('default').insert(0, [p]);
    });

    const shutUpdate = Y.encodeStateAsUpdate(clientShut.doc);
    const shutEnc = encoding.createEncoder();
    encoding.writeVarUint(shutEnc, MESSAGE_SYNC);
    syncProtocol.writeUpdate(shutEnc, shutUpdate);
    clientShut.ws.send(encoding.toUint8Array(shutEnc), { binary: true });

    // Allow the binary WebSocket frame to be received and processed by the server
    await new Promise((r) => setTimeout(r, 60));

    // Call server.close() immediately without waiting for debounce
    console.log('Invoking serverInstance.close() with active unsaved room...');
    await serverInstance.close();
    serverInstance = null; // Mark closed

    const shutdownPersisted = await prisma.documentState.findUnique({ where: { pageId: pageShut.id } });
    report(
      'Graceful server shutdown flushes all active rooms to PostgreSQL',
      shutdownPersisted !== null && shutdownPersisted.yjsState.length > 0,
      `Shutdown saved bytes: ${shutdownPersisted?.yjsState?.length}`
    );

    // ------------------------------------------------------------------------
    // Test 11: Database Failures Do Not Cause False Success
    // ------------------------------------------------------------------------
    console.log('\n--- Test 11: Database Failure Handling ---');
    // Start fresh server instance on another port with failing database loader
    const serverNegative = createCollabServer({
      port: TEST_PORT + 1,
      host: TEST_HOST,
      authTimeoutMs: 1500,
      allowedOrigins: ['http://localhost:3000'],
      loadDocumentState: async () => {
        throw new Error('Simulated PostgreSQL Connection Error');
      },
    });
    await serverNegative.start();

    const tokenFailPage = await generateTestToken({
      userId: testUser.id,
      userName: testUser.name,
      pageId: pageHydrate.id,
      workspaceId: testWorkspace.id,
      role: 'EDITOR',
    });

    const badWs = new WebSocket(`ws://${TEST_HOST}:${TEST_PORT + 1}/${pageHydrate.id}`, {
      headers: { Origin: 'http://localhost:3000' },
    });

    let badClosed = false;
    let closeCode = 0;
    badWs.on('open', () => {
      badWs.send(JSON.stringify({ token: tokenFailPage }));
    });
    badWs.on('close', (code) => {
      badClosed = true;
      closeCode = code;
    });

    await new Promise((r) => setTimeout(r, 400));
    report(
      'Database hydration failure correctly rejects client connection without false success',
      badClosed && closeCode === 1011,
      `Socket closed with code ${closeCode}`
    );

    await serverNegative.close();

    // ------------------------------------------------------------------------
    // Test 12: Existing Auth, Roles, Origins, & Room Isolation Intact
    // ------------------------------------------------------------------------
    console.log('\n--- Test 12: Existing Security Policies Intact ---');
    const serverFinal = createCollabServer({
      port: TEST_PORT + 2,
      host: TEST_HOST,
      authTimeoutMs: 1500,
      allowedOrigins: ['http://localhost:3000'],
    });
    await serverFinal.start();

    // Untrusted Origin test
    let originRejected = false;
    const originWs = new WebSocket(`ws://${TEST_HOST}:${TEST_PORT + 2}/some-page`, {
      headers: { Origin: 'http://malicious-attacker.com' },
    });
    originWs.on('error', () => {
      originRejected = true;
    });
    await new Promise((r) => setTimeout(r, 300));

    report(
      'Untrusted Origin rejected during upgrade handshake (403 Forbidden)',
      originRejected,
      'Origin security check intact'
    );

    // Unauthorized role rejection test (Phase 9 expands legitimate roles to OWNER, EDITOR, COMMENTER, VIEWER; invalid role rejected)
    const tokenInvalid = await generateTestToken({
      userId: testUser.id,
      userName: testUser.name,
      pageId: pageHydrate.id,
      workspaceId: testWorkspace.id,
      role: 'GUEST', // Rejected
    });

    let roleRejected = false;
    let roleCloseCode = 0;
    const invalidWs = new WebSocket(`ws://${TEST_HOST}:${TEST_PORT + 2}/${pageHydrate.id}`, {
      headers: { Origin: 'http://localhost:3000' },
    });
    invalidWs.on('open', () => {
      invalidWs.send(JSON.stringify({ token: tokenInvalid }));
    });
    invalidWs.on('close', (code) => {
      roleRejected = true;
      roleCloseCode = code;
    });
    await new Promise((r) => setTimeout(r, 400));

    report(
      'Unauthorized role rejected with 4403 Forbidden',
      roleRejected && roleCloseCode === 4403,
      `Close code: ${roleCloseCode}`
    );

    await serverFinal.close();

  } finally {
    console.log('\n--- Cleaning up temporary test records ---');
    if (serverInstance) {
      try {
        await serverInstance.close();
      } catch {}
    }
    for (const pageId of createdPageIds) {
      try {
        await prisma.page.delete({ where: { id: pageId } });
      } catch {}
    }
    await closePersistence();
    console.log('Test cleanup complete.');
  }

  console.log('\n======================================================================');
  console.log(`Phase 8 Step 3 Verification Results: ${passedCount} / ${passedCount + failedCount} Passed`);
  console.log('======================================================================');

  process.exit(failedCount > 0 ? 1 : 0);
}

runSuite().catch((err) => {
  console.error('Unhandled test error:', err);
  process.exit(1);
});
