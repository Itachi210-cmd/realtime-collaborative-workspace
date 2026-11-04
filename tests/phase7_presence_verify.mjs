/**
 * Phase 7 Verification Suite: Presence, Cursors & Undo/Redo Engine
 *
 * Verifies all 10 Phase 7 requirements using the real production
 * createCollabWebsocketProvider and CollabServer:
 * 1. Deterministic Collaborator Colours & Initials
 * 2. Local Undo/Redo (CRDT UndoManager reverts and reapplies edits)
 * 3. Collaborative Undo/Redo isolation between two collaborators
 * 4. Avatar presence protocol exchange (Awareness propagation)
 * 5. Live remote cursor (Caret positions broadcast and received across sessions)
 * 6. Remote text selection highlight broadcast
 * 7. Graceful disconnect (Provider destroy immediately removes user presence)
 * 8. Abrupt disconnect (Server detects socket close and removes awareness states immediately)
 * 9. Reconnect restoration (User reconnects and awareness is seamlessly re-established)
 * 10. TipTap Collaboration & CollaborationCursor Integration
 */

import { WebSocket } from 'ws';
import * as Y from 'yjs';
import { SignJWT } from 'jose';
import fs from 'node:fs';
import path from 'node:path';
import { createCollabServer } from '../src/server/collab-server.mjs';
import { createCollabWebsocketProvider } from '../src/lib/collab/collab-provider.mjs';
import { getCollaboratorColor, getInitials } from '../src/lib/collab/collab-colors.ts';

// Load .env.local
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

const TEST_PORT = 19448;
const AUTH_SECRET = process.env.AUTH_SECRET || 'collab-workspace-super-secret-jwt-signing-key-32-chars-min!';
const SECRET_KEY = new TextEncoder().encode(AUTH_SECRET);
const ISSUER = 'collab-workspace-auth';
const AUDIENCE = 'collab-workspace-yjs';

async function signTestToken({ userId, userName, pageId, role = 'EDITOR', workspaceId = 'ws-test' }) {
  return new SignJWT({
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
    .setExpirationTime('120s')
    .sign(SECRET_KEY);
}

function waitForSync(provider, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    if (provider.synced) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for provider sync on room "${provider.roomname}"`));
    }, timeoutMs);

    provider.once('sync', (isSynced) => {
      if (isSynced) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
}

function waitForCondition(checkFn, timeoutMs = 4000, intervalMs = 30) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const interval = setInterval(() => {
      try {
        if (checkFn()) {
          clearInterval(interval);
          resolve();
          return;
        }
      } catch (err) {
        clearInterval(interval);
        reject(err);
        return;
      }
      if (Date.now() - startTime > timeoutMs) {
        clearInterval(interval);
        reject(new Error(`Condition timed out after ${timeoutMs}ms`));
      }
    }, intervalMs);
  });
}

async function runPhase7Tests() {
  console.log('================================================================');
  console.log('   PHASE 7 VERIFICATION: Presence, Cursors & Undo/Redo Engine   ');
  console.log('================================================================\n');

  let passed = 0;
  const total = 10;

  // 1. Start test server on 127.0.0.1
  const serverInstance = createCollabServer({
    port: TEST_PORT,
    host: '127.0.0.1',
    cleanupGraceMs: 300,
  });

  await serverInstance.start();
  const serverUrl = `ws://127.0.0.1:${TEST_PORT}`;

  try {
    // -------------------------------------------------------------
    // Test 1: Deterministic Collaborator Colours & Initials
    // -------------------------------------------------------------
    console.log('Test 1: Deterministic Collaborator Colours & Initials');
    const color1 = getCollaboratorColor('user-alpha');
    const color2 = getCollaboratorColor('user-alpha');
    const color3 = getCollaboratorColor('user-beta');
    const initials1 = getInitials('Sanyasi Behera');
    const initials2 = getInitials('Jane Doe');
    const initials3 = getInitials('SingleName');

    if (
      color1.hex === color2.hex &&
      color1.hex !== color3.hex &&
      initials1 === 'SB' &&
      initials2 === 'JD' &&
      initials3 === 'SI'
    ) {
      console.log('  [PASS] Hash is deterministic, distinct across users, initials clean.\n');
      passed++;
    } else {
      throw new Error(`Color or initial hash mismatch: ${color1.hex} vs ${color3.hex}`);
    }

    // -------------------------------------------------------------
    // Test 2: Local Undo/Redo (CRDT UndoManager)
    // -------------------------------------------------------------
    console.log('Test 2: Local Undo/Redo with Yjs UndoManager');
    const doc = new Y.Doc();
    const text = doc.getText('content');
    const undoManager = new Y.UndoManager(text);

    text.insert(0, 'Hello ');
    undoManager.stopCapturing();

    text.insert(6, 'World');
    undoManager.stopCapturing();

    if (text.toString() !== 'Hello World') {
      throw new Error(`Expected 'Hello World', got '${text.toString()}'`);
    }

    undoManager.undo();
    if (text.toString() !== 'Hello ') {
      throw new Error(`Undo step 2 failed. Expected 'Hello ', got '${text.toString()}'`);
    }

    undoManager.undo();
    if (text.toString() !== '') {
      throw new Error(`Undo step 1 failed. Expected empty, got '${text.toString()}'`);
    }

    undoManager.redo();
    if (text.toString() !== 'Hello ') {
      throw new Error(`Redo step 1 failed. Expected 'Hello ', got '${text.toString()}'`);
    }

    undoManager.redo();
    if (text.toString() !== 'Hello World') {
      throw new Error(`Redo step 2 failed. Expected 'Hello World', got '${text.toString()}'`);
    }

    console.log('  [PASS] Local Undo/Redo perfectly reverts and re-applies changes.\n');
    passed++;

    // -------------------------------------------------------------
    // Test 3: Collaborative Undo/Redo Isolation
    // -------------------------------------------------------------
    console.log('Test 3: Collaborative Undo/Redo Isolation Between Peers');
    const pageIdUndo = 'room-phase7-undo-iso';
    const docA = new Y.Doc();
    const docB = new Y.Doc();

    const pA = createCollabWebsocketProvider({
      workspaceId: 'ws-test',
      pageId: pageIdUndo,
      ydoc: docA,
      serverUrl,
      getToken: () => signTestToken({ userId: 'user-a', userName: 'User A', pageId: pageIdUndo }),
      BaseWS: WebSocket,
      disableBc: true,
    });

    const pB = createCollabWebsocketProvider({
      workspaceId: 'ws-test',
      pageId: pageIdUndo,
      ydoc: docB,
      serverUrl,
      getToken: () => signTestToken({ userId: 'user-b', userName: 'User B', pageId: pageIdUndo }),
      BaseWS: WebSocket,
      disableBc: true,
    });

    await Promise.all([waitForSync(pA), waitForSync(pB)]);

    const textA = docA.getText('content');
    const textB = docB.getText('content');

    // Create UndoManager for Client A, tracking edits where origin === 'user-a-origin'
    const undoManagerA = new Y.UndoManager(textA, {
      trackedOrigins: new Set(['user-a-origin']),
    });

    // User A types "A-TEXT "
    docA.transact(() => {
      textA.insert(0, 'A-TEXT ');
    }, 'user-a-origin');
    undoManagerA.stopCapturing();

    // Wait for User B to receive "A-TEXT "
    await waitForCondition(() => textB.toString() === 'A-TEXT ');

    // User B types "B-TEXT"
    docB.transact(() => {
      textB.insert(textB.length, 'B-TEXT');
    }, 'user-b-origin');

    // Wait for both to converge on "A-TEXT B-TEXT"
    await waitForCondition(() => textA.toString() === 'A-TEXT B-TEXT' && textB.toString() === 'A-TEXT B-TEXT');

    // User A executes Undo
    undoManagerA.undo();

    // User A's edit ("A-TEXT ") must be removed, but User B's edit ("B-TEXT") MUST REMAIN!
    await waitForCondition(() => textA.toString() === 'B-TEXT' && textB.toString() === 'B-TEXT');

    console.log('  [PASS] User A undo removed only User A edits; User B edits preserved intact.\n');
    passed++;

    pA.destroy();
    pB.destroy();

    // -------------------------------------------------------------
    // Test 4: Avatar Presence Protocol
    // -------------------------------------------------------------
    console.log('Test 4: Avatar Presence Protocol Exchange');
    const pageIdPresence = 'room-phase7-presence';
    const docAlice = new Y.Doc();
    const docBob = new Y.Doc();

    const colorAlice = getCollaboratorColor('user-alice').hex;
    const colorBob = getCollaboratorColor('user-bob').hex;

    const pAlice = createCollabWebsocketProvider({
      workspaceId: 'ws-test',
      pageId: pageIdPresence,
      ydoc: docAlice,
      serverUrl,
      getToken: () => signTestToken({ userId: 'user-alice', userName: 'Alice', pageId: pageIdPresence }),
      BaseWS: WebSocket,
      disableBc: true,
    });

    const pBob = createCollabWebsocketProvider({
      workspaceId: 'ws-test',
      pageId: pageIdPresence,
      ydoc: docBob,
      serverUrl,
      getToken: () => signTestToken({ userId: 'user-bob', userName: 'Bob', pageId: pageIdPresence }),
      BaseWS: WebSocket,
      disableBc: true,
    });

    pAlice.awareness.setLocalStateField('user', {
      id: 'user-alice',
      name: 'Alice',
      color: colorAlice,
      role: 'OWNER',
    });

    pBob.awareness.setLocalStateField('user', {
      id: 'user-bob',
      name: 'Bob',
      color: colorBob,
      role: 'EDITOR',
    });

    await Promise.all([waitForSync(pAlice), waitForSync(pBob)]);

    await waitForCondition(() => {
      const aliceStates = Array.from(pAlice.awareness.getStates().values()).map((s) => s.user?.name);
      const bobStates = Array.from(pBob.awareness.getStates().values()).map((s) => s.user?.name);
      return (
        aliceStates.includes('Alice') &&
        aliceStates.includes('Bob') &&
        bobStates.includes('Alice') &&
        bobStates.includes('Bob')
      );
    });

    console.log('  [PASS] Both clients successfully receive each other\'s presence states.\n');
    passed++;

    // -------------------------------------------------------------
    // Test 5: Live Remote Cursor Caret Broadcast
    // -------------------------------------------------------------
    console.log('Test 5: Live Remote Cursor Caret Broadcast');
    pBob.awareness.setLocalStateField('cursor', { anchor: 4, head: 4 });

    await waitForCondition(() => {
      let found = false;
      pAlice.awareness.getStates().forEach((state, cid) => {
        if (cid !== pAlice.awareness.clientID && state.cursor?.anchor === 4) {
          found = true;
        }
      });
      return found;
    });

    console.log('  [PASS] Alice received Bob\'s live remote caret position (index: 4).\n');
    passed++;

    // -------------------------------------------------------------
    // Test 6: Remote Text Selection Broadcast
    // -------------------------------------------------------------
    console.log('Test 6: Remote Text Selection Highlight Broadcast');
    pBob.awareness.setLocalStateField('cursor', { anchor: 2, head: 7 });

    await waitForCondition(() => {
      let found = false;
      pAlice.awareness.getStates().forEach((state, cid) => {
        if (cid !== pAlice.awareness.clientID && state.cursor?.anchor === 2 && state.cursor?.head === 7) {
          found = true;
        }
      });
      return found;
    });

    console.log('  [PASS] Alice received Bob\'s remote selection highlight range (anchor: 2, head: 7).\n');
    passed++;

    // -------------------------------------------------------------
    // Test 7: Graceful Disconnect
    // -------------------------------------------------------------
    console.log('Test 7: Graceful Disconnect Cleanup');
    pBob.destroy();

    await waitForCondition(() => {
      const remainingUsers = Array.from(pAlice.awareness.getStates().values())
        .map((s) => s.user?.name)
        .filter(Boolean);
      return remainingUsers.length === 1 && remainingUsers[0] === 'Alice';
    });

    console.log('  [PASS] Bob gracefully disconnected; Alice\'s awareness updated immediately.\n');
    passed++;

    pAlice.destroy();

    // -------------------------------------------------------------
    // Test 8: Abrupt Disconnect (Socket Killed, No Cleanup Packet)
    // -------------------------------------------------------------
    console.log('Test 8: Abrupt Disconnect Immediate Server Cleanup (No Ghost Cursors)');
    const pageIdAbrupt = 'room-phase7-abrupt';
    const docCarol = new Y.Doc();
    const docDave = new Y.Doc();

    const pCarol = createCollabWebsocketProvider({
      workspaceId: 'ws-test',
      pageId: pageIdAbrupt,
      ydoc: docCarol,
      serverUrl,
      getToken: () => signTestToken({ userId: 'user-carol', userName: 'Carol', pageId: pageIdAbrupt }),
      BaseWS: WebSocket,
      disableBc: true,
    });

    const pDave = createCollabWebsocketProvider({
      workspaceId: 'ws-test',
      pageId: pageIdAbrupt,
      ydoc: docDave,
      serverUrl,
      getToken: () => signTestToken({ userId: 'user-dave', userName: 'Dave', pageId: pageIdAbrupt }),
      BaseWS: WebSocket,
      disableBc: true,
    });

    pCarol.awareness.setLocalStateField('user', { id: 'user-carol', name: 'Carol' });
    pDave.awareness.setLocalStateField('user', { id: 'user-dave', name: 'Dave' });

    await Promise.all([waitForSync(pCarol), waitForSync(pDave)]);

    await waitForCondition(() => {
      const carolUsers = Array.from(pCarol.awareness.getStates().values()).map((s) => s.user?.name);
      return carolUsers.includes('Dave');
    });

    // Abruptly terminate Dave's underlying WebSocket transport without sending cleanup
    const underlyingWs = pDave.ws?.rawWs || pDave.ws;
    if (underlyingWs && typeof underlyingWs.terminate === 'function') {
      underlyingWs.terminate();
    }

    // Server must detect TCP close and immediately remove Dave's awareness states
    await waitForCondition(() => {
      const carolUsers = Array.from(pCarol.awareness.getStates().values()).map((s) => s.user?.name).filter(Boolean);
      return !carolUsers.includes('Dave') && carolUsers.includes('Carol');
    });

    console.log('  [PASS] Server immediately removed Dave on abrupt disconnect without 30s timeout.\n');
    passed++;

    pDave.destroy();
    pCarol.destroy();

    // -------------------------------------------------------------
    // Test 9: Reconnect Restoration
    // -------------------------------------------------------------
    console.log('Test 9: Reconnect Restoration');
    const pageIdRec = 'room-phase7-reconnect';
    const docEve = new Y.Doc();
    let docFrank = new Y.Doc();

    const pEve = createCollabWebsocketProvider({
      workspaceId: 'ws-test',
      pageId: pageIdRec,
      ydoc: docEve,
      serverUrl,
      getToken: () => signTestToken({ userId: 'user-eve', userName: 'Eve', pageId: pageIdRec }),
      BaseWS: WebSocket,
      disableBc: true,
    });

    let pFrank = createCollabWebsocketProvider({
      workspaceId: 'ws-test',
      pageId: pageIdRec,
      ydoc: docFrank,
      serverUrl,
      getToken: () => signTestToken({ userId: 'user-frank', userName: 'Frank', pageId: pageIdRec }),
      BaseWS: WebSocket,
      disableBc: true,
    });

    pEve.awareness.setLocalStateField('user', { id: 'user-eve', name: 'Eve' });
    pFrank.awareness.setLocalStateField('user', { id: 'user-frank', name: 'Frank' });

    await Promise.all([waitForSync(pEve), waitForSync(pFrank)]);

    // Frank disconnects
    pFrank.destroy();

    await waitForCondition(() => {
      const eveUsers = Array.from(pEve.awareness.getStates().values()).map((s) => s.user?.name).filter(Boolean);
      return !eveUsers.includes('Frank');
    });

    // Frank reconnects with new provider
    docFrank = new Y.Doc();
    pFrank = createCollabWebsocketProvider({
      workspaceId: 'ws-test',
      pageId: pageIdRec,
      ydoc: docFrank,
      serverUrl,
      getToken: () => signTestToken({ userId: 'user-frank', userName: 'Frank', pageId: pageIdRec }),
      BaseWS: WebSocket,
      disableBc: true,
    });
    pFrank.awareness.setLocalStateField('user', { id: 'user-frank', name: 'Frank' });

    await waitForSync(pFrank);

    await waitForCondition(() => {
      const eveUsers = Array.from(pEve.awareness.getStates().values()).map((s) => s.user?.name).filter(Boolean);
      const frankUsers = Array.from(pFrank.awareness.getStates().values()).map((s) => s.user?.name).filter(Boolean);
      return eveUsers.includes('Frank') && frankUsers.includes('Eve');
    });

    console.log('  [PASS] Reconnection seamlessly restored mutual awareness presence.\n');
    passed++;

    pEve.destroy();
    pFrank.destroy();

    // -------------------------------------------------------------
    // Test 10: TipTap Collaboration & CollaborationCursor Integration
    // -------------------------------------------------------------
    console.log('Test 10: TipTap Collaboration & CollaborationCursor Integration');
    const colExt = await import('@tiptap/extension-collaboration');
    const colCurExt = await import('@tiptap/extension-collaboration-cursor');

    const hasCollab = Boolean(colExt.Collaboration);
    const hasCollabCursor = Boolean(colCurExt.CollaborationCursor);

    const defaultCollab = colExt.Collaboration.configure({ document: new Y.Doc() });
    const commands = defaultCollab.config.addCommands?.() || {};

    if (hasCollab && hasCollabCursor && typeof commands.undo === 'function' && typeof commands.redo === 'function') {
      console.log('  [PASS] TipTap Collaboration and CollaborationCursor extensions registered with undo/redo.\n');
      passed++;
    } else {
      throw new Error('TipTap Collaboration extension missing undo/redo commands.');
    }

  } finally {
    if (serverInstance && typeof serverInstance.close === 'function') {
      await serverInstance.close();
    }
  }

  console.log('================================================================');
  console.log(`   PHASE 7 VERIFICATION COMPLETE: ${passed}/${total} PASSED    `);
  console.log('================================================================');

  if (passed !== total) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runPhase7Tests().catch((err) => {
  console.error('\n[FATAL] Phase 7 test suite failed:', err);
  process.exit(1);
});
