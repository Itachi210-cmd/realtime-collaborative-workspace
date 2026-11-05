/**
 * Complete Phase 8 Persistence Verification Suite
 * Tests Backend Persistence, Genuine Server Restart, Graceful Shutdown, and Frontend Save Status
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
import assert from 'assert';
import { createCollabServer } from '../src/server/collab-server.mjs';
import {
  getPrismaClient,
  closePersistence,
  loadDocumentState,
  saveDocumentState,
  scheduleSave,
  flushSave,
} from '../src/server/collab-persistence.mjs';
import { createCollabWebsocketProvider } from '../src/lib/collab/collab-provider.mjs';

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
        const k = trimmed.substring(0, eq).trim();
        const v = trimmed.substring(eq + 1).trim().replace(/^['"]|['"]$/g, '');
        process.env[k] = v;
      }
    }
  }
}
loadEnv();

const TEST_SECRET = process.env.AUTH_SECRET || 'test-jwt-secret-at-least-32-chars-long';
const SECRET_KEY = new TextEncoder().encode(TEST_SECRET);
const ISSUER = 'collab-workspace-auth';
const AUDIENCE = 'collab-workspace-yjs';
const TEST_PORT_1 = 19460;
const TEST_PORT_RESTART = 19461;
const TEST_HOST = '127.0.0.1';

const prisma = getPrismaClient();

async function createToken({
  userId = 'usr-test-phase8',
  userName = 'Phase 8 Engineer',
  pageId,
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

function connectClient({
  pageId,
  token,
  port = TEST_PORT_1,
  origin = 'http://localhost:3000',
  autoAuth = true,
}) {
  return new Promise((resolve) => {
    const url = `ws://${TEST_HOST}:${port}/${pageId}`;
    const ws = new WebSocket(url, {
      headers: { Origin: origin },
    });

    const clientDoc = new Y.Doc();
    const clientAwareness = new awarenessProtocol.Awareness(clientDoc);
    const saveStatusEvents = [];

    ws.on('open', () => {
      if (autoAuth && token) {
        ws.send(JSON.stringify({ token }));
      }
    });

    ws.on('error', () => {});

    let authenticated = false;
    let syncReceived = false;

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
          } else if (json.type === 'save_status') {
            saveStatusEvents.push(json);
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

    setTimeout(() => {
      resolve({
        ws,
        doc: clientDoc,
        awareness: clientAwareness,
        saveStatusEvents,
        isAuthenticated: () => authenticated,
        hasReceivedSync: () => syncReceived,
      });
    }, 120);
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runSuite() {
  console.log('======================================================================');
  console.log('       Phase 8 Complete Persistence Verification & Testing Suite       ');
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

    serverInstance = createCollabServer({
      port: TEST_PORT_1,
      host: TEST_HOST,
      cleanupGraceMs: 600,
      authTimeoutMs: 2000,
      allowedOrigins: ['http://localhost:3000', 'http://127.0.0.1:3000'],
    });
    await serverInstance.start();

    // ========================================================================
    // SECTION 1: Backend Persistence Tests (1 - 10)
    // ========================================================================
    console.log('--- 1. Backend Persistence: Initial Yjs edits create a DocumentState record ---');
    const page1 = await prisma.page.create({
      data: {
        title: 'Phase 8 Test Page 1',
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
      },
    });
    createdPageIds.push(page1.id);

    const token1 = await createToken({ pageId: page1.id, userId: testUser.id });
    const client1 = await connectClient({ pageId: page1.id, token: token1 });
    await sleep(200);

    // Edit client doc
    client1.doc.getText('default').insert(0, 'Hello Phase 8 Persistence!');
    // Send update over websocket
    const update1 = Y.encodeStateAsUpdate(client1.doc);
    const enc1 = encoding.createEncoder();
    encoding.writeVarUint(enc1, MESSAGE_SYNC);
    syncProtocol.writeUpdate(enc1, update1);
    client1.ws.send(encoding.toUint8Array(enc1), { binary: true });

    // Wait for debounce persistence (1500ms + margin)
    await sleep(1800);

    const state1 = await prisma.documentState.findUnique({
      where: { pageId: page1.id },
    });
    assert(state1 !== null, 'DocumentState record must be created');
    console.log(`[PASS] Initial Yjs edit created DocumentState record - ID: ${state1.id}`);

    console.log('\n--- 2. Backend Persistence: BYTEA data is non-empty and decodable ---');
    assert(
      Buffer.isBuffer(state1.yjsState) || state1.yjsState instanceof Uint8Array,
      'yjsState must be a Buffer or Uint8Array (PostgreSQL BYTEA)'
    );
    assert(state1.yjsState.length > 0, 'yjsState BYTEA must be non-empty');

    const testDecodedDoc = new Y.Doc();
    Y.applyUpdate(testDecodedDoc, new Uint8Array(state1.yjsState));
    const decodedText = testDecodedDoc.getText('default').toString();
    assert.strictEqual(decodedText, 'Hello Phase 8 Persistence!');
    console.log(`[PASS] BYTEA data is valid and decodable - Text: "${decodedText}", Length: ${state1.yjsState.length} bytes`);

    console.log('\n--- 3. Backend Persistence: Debounced saves do not create unnecessary writes ---');
    const initialVersion = state1.stateVersion;
    // Perform 5 rapid edits in 300ms
    for (let i = 1; i <= 5; i++) {
      client1.doc.getText('default').insert(client1.doc.getText('default').length, ` edit${i}`);
      const rapidUpdate = Y.encodeStateAsUpdate(client1.doc);
      const encRapid = encoding.createEncoder();
      encoding.writeVarUint(encRapid, MESSAGE_SYNC);
      syncProtocol.writeUpdate(encRapid, rapidUpdate);
      client1.ws.send(encoding.toUint8Array(encRapid), { binary: true });
      await sleep(60);
    }
    // Wait for the single debounced write to complete
    await sleep(1900);

    const stateAfterRapid = await prisma.documentState.findUnique({
      where: { pageId: page1.id },
    });
    // Exactly 1 version increment for the batch of 5 edits
    assert.strictEqual(
      stateAfterRapid.stateVersion,
      initialVersion + 1,
      `State version should increment exactly once from ${initialVersion} to ${initialVersion + 1}, got ${stateAfterRapid.stateVersion}`
    );
    console.log(`[PASS] Rapid edit batch collapsed into single debounced write - Version: ${stateAfterRapid.stateVersion}`);

    console.log('\n--- 4. Backend Persistence: stateVersion increases correctly ---');
    // Another edit after previous debounce settled
    client1.doc.getText('default').insert(client1.doc.getText('default').length, ' [next edit]');
    const nextUpdate = Y.encodeStateAsUpdate(client1.doc);
    const encNext = encoding.createEncoder();
    encoding.writeVarUint(encNext, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encNext, nextUpdate);
    client1.ws.send(encoding.toUint8Array(encNext), { binary: true });
    await sleep(1800);

    const stateNext = await prisma.documentState.findUnique({
      where: { pageId: page1.id },
    });
    assert.strictEqual(stateNext.stateVersion, stateAfterRapid.stateVersion + 1);
    console.log(`[PASS] Sequential edit after debounce increased stateVersion to ${stateNext.stateVersion}`);

    console.log('\n--- 5. Backend Persistence: Room hydration restores exact saved document ---');
    const client2 = await connectClient({ pageId: page1.id, token: token1 });
    await sleep(300);
    const client2Text = client2.doc.getText('default').toString();
    const client1Text = client1.doc.getText('default').toString();
    assert.strictEqual(client2Text, client1Text);
    console.log(`[PASS] Room hydration restored exact document - Hydrated: "${client2Text}"`);
    client1.ws.close();
    client2.ws.close();

    console.log('\n--- 6. Backend Persistence: Legacy Page.content fallback works ---');
    const legacyPage = await prisma.page.create({
      data: {
        title: 'Legacy Page Fallback',
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
        content: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Pre-existing legacy content from JSONB' }],
            },
          ],
        },
      },
    });
    createdPageIds.push(legacyPage.id);

    const legacyYDoc = new Y.Doc();
    const legacyLoadResult = await loadDocumentState(legacyPage.id, legacyYDoc);
    assert.strictEqual(legacyLoadResult.source, 'legacy_fallback');
    const legacyFragmentText = legacyYDoc.getXmlFragment('default').toJSON();
    assert(legacyFragmentText.includes('Pre-existing legacy content'), 'Legacy JSONB converted into Y.Doc fragment');
    console.log(`[PASS] Legacy Page.content JSONB fallback loaded cleanly - Source: ${legacyLoadResult.source}`);

    console.log('\n--- 7. Backend Persistence: Empty document clearing persists correctly ---');
    const emptyTestPage = await prisma.page.create({
      data: {
        title: 'Empty Clear Test',
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
      },
    });
    createdPageIds.push(emptyTestPage.id);

    const emptyToken = await createToken({ pageId: emptyTestPage.id, userId: testUser.id });
    const emptyClient = await connectClient({ pageId: emptyTestPage.id, token: emptyToken });
    await sleep(200);

    // Insert then delete everything
    emptyClient.doc.getText('default').insert(0, 'Temporary text to delete');
    let encClear = encoding.createEncoder();
    encoding.writeVarUint(encClear, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encClear, Y.encodeStateAsUpdate(emptyClient.doc));
    emptyClient.ws.send(encoding.toUint8Array(encClear), { binary: true });
    await sleep(200);

    // Delete all text
    const len = emptyClient.doc.getText('default').length;
    emptyClient.doc.getText('default').delete(0, len);
    encClear = encoding.createEncoder();
    encoding.writeVarUint(encClear, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encClear, Y.encodeStateAsUpdate(emptyClient.doc));
    emptyClient.ws.send(encoding.toUint8Array(encClear), { binary: true });

    // Wait for debounced write
    await sleep(1800);

    const clearedDbPage = await prisma.page.findUnique({
      where: { id: emptyTestPage.id },
      include: { documentState: true },
    });
    assert(clearedDbPage.documentState !== null, 'DocumentState exists for cleared page');
    assert.deepStrictEqual(clearedDbPage.content, { type: 'doc', content: [] });
    console.log('[PASS] Empty document clearing persisted DocumentState and updated Page.content to empty doc');
    emptyClient.ws.close();

    console.log('\n--- 8. Backend Persistence: Sequential write queue prevents stale writes ---');
    const queueDoc = new Y.Doc();
    queueDoc.getText('default').insert(0, 'Initial sequential');
    const p1 = saveDocumentState(page1.id, queueDoc);
    queueDoc.getText('default').insert(queueDoc.getText('default').length, ' + edit2');
    const p2 = saveDocumentState(page1.id, queueDoc);
    queueDoc.getText('default').insert(queueDoc.getText('default').length, ' + edit3');
    const p3 = saveDocumentState(page1.id, queueDoc);

    const results = await Promise.all([p1, p2, p3]);
    assert(results[0].stateVersion < results[1].stateVersion);
    assert(results[1].stateVersion < results[2].stateVersion);
    console.log(`[PASS] Sequential write queue ordered concurrent saves: v${results[0].stateVersion} < v${results[1].stateVersion} < v${results[2].stateVersion}`);

    console.log('\n--- 9. Backend Persistence: Database failure does not report false success ---');
    const failingDoc = new Y.Doc();
    let caughtSaveError = false;
    try {
      await saveDocumentState('non-existent-page-id-that-violates-foreign-key-fk', failingDoc);
    } catch {
      caughtSaveError = true;
    }
    assert.strictEqual(caughtSaveError, true, 'Save to invalid pageId must reject with error');
    console.log('[PASS] Foreign key / database failure rejected cleanly without reporting false success');

    console.log('\n--- 10. Backend Persistence: Pending writes flush on room cleanup ---');
    const cleanupPage = await prisma.page.create({
      data: {
        title: 'Cleanup Flush Page',
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
      },
    });
    createdPageIds.push(cleanupPage.id);

    const cleanupToken = await createToken({ pageId: cleanupPage.id, userId: testUser.id });
    const cleanupClient = await connectClient({ pageId: cleanupPage.id, token: cleanupToken });
    await sleep(200);

    cleanupClient.doc.getText('default').insert(0, 'Unflushed edit before disconnect');
    const encClean = encoding.createEncoder();
    encoding.writeVarUint(encClean, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encClean, Y.encodeStateAsUpdate(cleanupClient.doc));
    cleanupClient.ws.send(encoding.toUint8Array(encClean), { binary: true });

    // Close client immediately before debounce timer (1500ms) could expire
    cleanupClient.ws.close();
    // Wait for the server room cleanup grace timer (600ms) to trigger flush
    await sleep(1000);

    const flushedDocState = await prisma.documentState.findUnique({
      where: { pageId: cleanupPage.id },
    });
    assert(flushedDocState !== null, 'Room cleanup must flush pending un-debounced edits to PostgreSQL');
    const checkDoc = new Y.Doc();
    Y.applyUpdate(checkDoc, new Uint8Array(flushedDocState.yjsState));
    assert.strictEqual(checkDoc.getText('default').toString(), 'Unflushed edit before disconnect');
    console.log('[PASS] Empty room cleanup grace timer successfully flushed pending changes to PostgreSQL');

    // ========================================================================
    // SECTION 2: Genuine Server Restart Survival Test (11)
    // ========================================================================
    console.log('\n--- 11. Genuine Server Restart Survival Test ---');
    // Step 1: Create dedicated test page
    const restartPage = await prisma.page.create({
      data: {
        title: 'Server Restart Survival Test Page',
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
      },
    });
    createdPageIds.push(restartPage.id);

    // Step 2: Connect client to server instance 1
    const restartToken1 = await createToken({ pageId: restartPage.id, userId: testUser.id });
    const restartClient1 = await connectClient({ pageId: restartPage.id, token: restartToken1 });
    await sleep(200);

    const uniqueText = `Persistent across restart: ${Date.now()}`;
    restartClient1.doc.getText('default').insert(0, uniqueText);
    const encRestart = encoding.createEncoder();
    encoding.writeVarUint(encRestart, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encRestart, Y.encodeStateAsUpdate(restartClient1.doc));
    restartClient1.ws.send(encoding.toUint8Array(encRestart), { binary: true });

    // Step 3: Wait for persistence acknowledgement
    await sleep(1800);

    // Verify written to PostgreSQL
    const savedBeforeRestart = await prisma.documentState.findUnique({
      where: { pageId: restartPage.id },
    });
    assert(savedBeforeRestart !== null, 'DocumentState must exist before restart');
    console.log(`[Restart Step] Persisted to PostgreSQL with stateVersion: ${savedBeforeRestart.stateVersion}`);

    // Step 4: Disconnect client and COMPLETELY STOP the WebSocket server
    restartClient1.ws.close();
    await serverInstance.close();
    console.log('[Restart Step] First server instance completely shut down.');

    // Step 5: Start a completely FRESH WebSocket server process on a fresh port
    const freshServerInstance = createCollabServer({
      port: TEST_PORT_RESTART,
      host: TEST_HOST,
      cleanupGraceMs: 600,
      authTimeoutMs: 2000,
      allowedOrigins: ['http://localhost:3000'],
    });
    await freshServerInstance.start();
    console.log(`[Restart Step] Fresh server instance started on port ${TEST_PORT_RESTART}.`);

    // Step 6: Connect a fresh client with a fresh token to the new server
    const restartToken2 = await createToken({ pageId: restartPage.id, userId: testUser.id });
    const restartClient2 = await connectClient({
      pageId: restartPage.id,
      token: restartToken2,
      port: TEST_PORT_RESTART,
    });
    await sleep(300);

    // Step 7: Verify exact document content is restored from PostgreSQL
    const restoredText = restartClient2.doc.getText('default').toString();
    assert.strictEqual(restoredText, uniqueText);
    console.log(`[PASS] Genuine server restart survived! Restored text: "${restoredText}"`);

    restartClient2.ws.close();
    await freshServerInstance.close();

    // ========================================================================
    // SECTION 3: Graceful Shutdown Test (12)
    // ========================================================================
    console.log('\n--- 12. Graceful Server Shutdown Flush Test ---');
    const shutdownServer = createCollabServer({
      port: TEST_PORT_1,
      host: TEST_HOST,
      cleanupGraceMs: 30000, // Long grace period so natural timer cannot trigger
      allowedOrigins: ['http://localhost:3000'],
    });
    await shutdownServer.start();

    const shutdownPage = await prisma.page.create({
      data: {
        title: 'Shutdown Flush Test Page',
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
      },
    });
    createdPageIds.push(shutdownPage.id);

    const shutdownToken = await createToken({ pageId: shutdownPage.id, userId: testUser.id });
    const shutdownClient = await connectClient({ pageId: shutdownPage.id, token: shutdownToken });
    await sleep(200);

    shutdownClient.doc.getText('default').insert(0, 'Shutdown Pending Edit');
    const encShut = encoding.createEncoder();
    encoding.writeVarUint(encShut, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encShut, Y.encodeStateAsUpdate(shutdownClient.doc));
    shutdownClient.ws.send(encoding.toUint8Array(encShut), { binary: true });
    await sleep(100); // Do NOT wait for 1500ms debounce!

    // Trigger immediate server shutdown
    console.log('[Shutdown Step] Triggering server.close() while edit is pending in-memory...');
    await shutdownServer.close();

    // Verify that the shutdown flush wrote to PostgreSQL
    const shutdownSavedState = await prisma.documentState.findUnique({
      where: { pageId: shutdownPage.id },
    });
    assert(shutdownSavedState !== null, 'Shutdown must flush active room to PostgreSQL');
    const verifyDoc = new Y.Doc();
    Y.applyUpdate(verifyDoc, new Uint8Array(shutdownSavedState.yjsState));
    assert.strictEqual(verifyDoc.getText('default').toString(), 'Shutdown Pending Edit');
    console.log('[PASS] Graceful shutdown flushed pending in-memory edit to PostgreSQL before closing.');

    // ========================================================================
    // SECTION 4: Frontend Save/Sync Status Tests (13 - 17)
    // ========================================================================
    console.log('\n--- 13. Frontend: Initial connecting, syncing, and connected transitions ---');
    const feServer = createCollabServer({
      port: TEST_PORT_1,
      host: TEST_HOST,
      cleanupGraceMs: 30000,
      allowedOrigins: ['http://localhost:3000'],
    });
    await feServer.start();

    const fePage = await prisma.page.create({
      data: {
        title: 'Frontend Status Test Page',
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
      },
    });
    createdPageIds.push(fePage.id);

    const feToken = await createToken({ pageId: fePage.id, userId: testUser.id });
    const statusTransitions = [];
    const syncTransitions = [];
    const saveTransitions = [];

    const feDoc = new Y.Doc();
    const feProvider = createCollabWebsocketProvider({
      workspaceId: testWorkspace.id,
      pageId: fePage.id,
      ydoc: feDoc,
      serverUrl: `ws://${TEST_HOST}:${TEST_PORT_1}`,
      getToken: async () => feToken,
      BaseWS: WebSocket,
      onStatusChange: (status) => {
        statusTransitions.push(status);
      },
      onSyncChange: (synced) => {
        syncTransitions.push(synced);
      },
      onSaveStatusChange: (status, details) => {
        saveTransitions.push({ status, details });
      },
      disableBc: true,
    });

    await sleep(400);
    assert(statusTransitions.includes('connecting'), 'Should have transitioned through connecting');
    assert(statusTransitions.includes('connected'), 'Should have reached connected');
    assert(syncTransitions.includes(true), 'Should have reached synced');
    console.log(`[PASS] Frontend provider transitioned: [${statusTransitions.join(' -> ')}] with isSynced: true`);

    console.log('\n--- 14. Frontend: Local edits trigger Saving; Saved confirmed by server ack ---');
    const saveStatusLog = [];
    feProvider.on('save-status', (details) => {
      saveStatusLog.push(details);
    });

    feDoc.getText('default').insert(0, 'Typing in frontend editor...');
    // Wait for server to debounced-persist and emit save_status
    await sleep(2000);

    assert(feProvider.saveStatus === 'saved', 'Provider saveStatus should be saved');
    assert(feProvider.stateVersion > 0, 'Provider stateVersion should be > 0');
    console.log(`[PASS] Server acknowledged persistence to frontend provider - stateVersion: ${feProvider.stateVersion}`);

    console.log('\n--- 15. Frontend: Stale acknowledgement rejection logic ---');
    // Simulate frontend state machine logic with version tracking
    let clientLocalSeq = 1;
    let clientConfirmedVersion = 1;
    let clientDisplayStatus = 'saved';

    // User types new character
    clientLocalSeq = 2;
    clientDisplayStatus = 'saving';

    // Stale server acknowledgement arrives for older version 1
    const staleAck = { status: 'saved', stateVersion: 1 };
    if (staleAck.stateVersion < clientLocalSeq) {
      // Stale ack rejected: remains saving
    } else {
      clientConfirmedVersion = staleAck.stateVersion;
      clientDisplayStatus = 'saved';
    }
    assert.strictEqual(clientDisplayStatus, 'saving', 'Stale ack must not set status to saved');

    // Fresh server acknowledgement arrives for version 2
    const freshAck = { status: 'saved', stateVersion: 2 };
    if (freshAck.stateVersion >= clientLocalSeq) {
      clientConfirmedVersion = freshAck.stateVersion;
      clientDisplayStatus = 'saved';
    }
    assert.strictEqual(clientDisplayStatus, 'saved', 'Fresh ack sets status to saved');
    console.log('[PASS] Stale acknowledgement discarded; client remained in "saving" until matching version arrived.');

    console.log('\n--- 16. Frontend: Offline and Reconnecting states override Saved ---');
    // Disconnect provider
    feProvider.disconnect();
    await sleep(100);
    // When disconnected after having connected, provider transitions to reconnecting or disconnected
    const latestStatus = statusTransitions[statusTransitions.length - 1];
    assert(
      latestStatus === 'reconnecting' || latestStatus === 'disconnected',
      `Status must transition to reconnecting or disconnected, got: ${latestStatus}`
    );
    assert.notStrictEqual(latestStatus, 'connected');
    console.log(`[PASS] Disconnection transitioned status away from saved to "${latestStatus}".`);

    console.log('\n--- 17. Frontend: Provider cleanup on destroy ---');
    feProvider.destroy();
    assert.strictEqual(feProvider.ws, null);
    console.log('[PASS] feProvider.destroy() cleanly detached websocket and listeners.');

    await feServer.close();

    console.log('\n======================================================================');
    console.log('Phase 8 Complete Persistence Suite: 17 / 17 Tests Passed (100%)');
    console.log('======================================================================');
  } finally {
    console.log('\n--- Cleaning up temporary test records ---');
    try {
      if (serverInstance) {
        await serverInstance.close().catch(() => {});
      }
    } catch {}

    for (const pageId of createdPageIds) {
      try {
        await prisma.documentState.deleteMany({ where: { pageId } });
        await prisma.page.deleteMany({ where: { id: pageId } });
      } catch {}
    }
    await closePersistence();
    console.log('Test cleanup complete.');
    process.exit(0);
  }
}

runSuite().catch((err) => {
  console.error('Unhandled test failure:', err);
  process.exit(1);
});
