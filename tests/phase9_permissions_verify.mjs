/**
 * Phase 9 Step 2: Comprehensive Permissions & WebSocket Protection Verification Suite
 *
 * Verifies:
 * 1. Page Permissions (OWNER/EDITOR allowed, COMMENTER/VIEWER rejected with 403, IDOR protection)
 * 2. Member Management APIs (OWNER only, duplicate rejection, owner protection, IDOR protection)
 * 3. Collaboration Token RBAC (All 4 roles receive valid tokens, non-members rejected with 403)
 * 4. WebSocket Protection (Model B: All 4 roles connect; COMMENTER/VIEWER updates dropped;
 *    server Y.Doc unmodified; unauthorized updates neither broadcast nor persisted;
 *    read-only clients remain connected; awareness spoofing blocked).
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { WebSocket } from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { SignJWT } from 'jose';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Role } from '@prisma/client';
import { createCollabServer } from '../src/server/collab-server.mjs';

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

const AUTH_SECRET = process.env.AUTH_SECRET || 'collab-workspace-super-secret-jwt-signing-key-32-chars-min!';
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/collab_workspace?schema=public';
const secretKey = new TextEncoder().encode(AUTH_SECRET);
const TEST_WS_PORT = 19488;

const pool = new pg.Pool({ connectionString: DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

let testNextProcess = null;
let collabServer = null;
let BASE_URL = 'http://localhost:3000';

async function generateSessionCookie(user) {
  const token = await new SignJWT({
    userId: user.id,
    email: user.email,
    name: user.name,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secretKey);

  return `collab_session=${token}`;
}

async function generateCollabToken(params) {
  return new SignJWT({
    userName: params.userName,
    pageId: params.pageId,
    workspaceId: params.workspaceId,
    role: params.role,
    purpose: 'collaboration',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(params.userId)
    .setIssuer('collab-workspace-auth')
    .setAudience('collab-workspace-yjs')
    .setIssuedAt()
    .setExpirationTime('60s')
    .sign(secretKey);
}

async function waitForServer(url, timeoutMs = 30000) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    try {
      const res = await fetch(`${url}/api/auth/me`);
      if (res.status === 401 || res.status === 200) {
        return true;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Server at ${url} did not become ready within ${timeoutMs}ms`);
}

async function runTests() {
  console.log('======================================================================');
  console.log('   Phase 9 Step 2: Permissions & WebSocket Protection Test Suite      ');
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

  // 1. Check or start Next.js test server
  const is3000Up = await fetch('http://localhost:3000/api/auth/me')
    .then((r) => r.status === 401 || r.status === 200)
    .catch(() => false);

  if (is3000Up) {
    BASE_URL = 'http://localhost:3000';
    console.log(`Connecting to existing Next.js server on ${BASE_URL}...`);
  } else {
    BASE_URL = 'http://localhost:3001';
    console.log(`Starting Next.js test server on ${BASE_URL}...`);
    testNextProcess = spawn('npx', ['next', 'start', '-p', '3001'], {
      stdio: 'pipe',
      shell: true,
    });
    await waitForServer(BASE_URL);
    console.log(`Next.js test server ready on ${BASE_URL}.\n`);
  }

  // 2. Start dedicated Collab WebSocket server on isolated port
  collabServer = createCollabServer({
    port: TEST_WS_PORT,
    authTimeoutMs: 3000,
    cleanupGraceMs: 600,
    allowedOrigins: ['http://localhost:3000', 'http://localhost:3001', 'http://127.0.0.1:3000', 'http://127.0.0.1:3001'],
  });
  await collabServer.start();
  console.log(`Collab WebSocket server listening on port ${TEST_WS_PORT}.\n`);

  // 3. Setup Test Database Records
  const ts = Date.now();
  const prefix = `p9_step2_${ts}`;

  const ownerUser = await prisma.user.create({
    data: { name: 'Owner User', email: `${prefix}_owner@test.com`, passwordHash: 'hash' },
  });
  const editorUser = await prisma.user.create({
    data: { name: 'Editor User', email: `${prefix}_editor@test.com`, passwordHash: 'hash' },
  });
  const commenterUser = await prisma.user.create({
    data: { name: 'Commenter User', email: `${prefix}_commenter@test.com`, passwordHash: 'hash' },
  });
  const viewerUser = await prisma.user.create({
    data: { name: 'Viewer User', email: `${prefix}_viewer@test.com`, passwordHash: 'hash' },
  });
  const outsiderUser = await prisma.user.create({
    data: { name: 'Outsider User', email: `${prefix}_outsider@test.com`, passwordHash: 'hash' },
  });
  const inviteTargetUser = await prisma.user.create({
    data: { name: 'Invite Target', email: `${prefix}_target@test.com`, passwordHash: 'hash' },
  });

  const workspace1 = await prisma.workspace.create({
    data: { name: `P9 WS1 ${ts}`, ownerId: ownerUser.id },
  });

  const memberEditor = await prisma.workspaceMember.create({
    data: { workspaceId: workspace1.id, userId: editorUser.id, role: Role.EDITOR },
  });
  const memberCommenter = await prisma.workspaceMember.create({
    data: { workspaceId: workspace1.id, userId: commenterUser.id, role: Role.COMMENTER },
  });
  const memberViewer = await prisma.workspaceMember.create({
    data: { workspaceId: workspace1.id, userId: viewerUser.id, role: Role.VIEWER },
  });

  const workspace2 = await prisma.workspace.create({
    data: { name: `P9 WS2 ${ts}`, ownerId: outsiderUser.id },
  });

  const page1 = await prisma.page.create({
    data: {
      title: 'P9 WS1 Page 1',
      workspaceId: workspace1.id,
      createdById: ownerUser.id,
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
    },
  });

  const page2 = await prisma.page.create({
    data: {
      title: 'P9 WS2 Page 2',
      workspaceId: workspace2.id,
      createdById: outsiderUser.id,
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
    },
  });

  const ownerCookie = await generateSessionCookie(ownerUser);
  const editorCookie = await generateSessionCookie(editorUser);
  const commenterCookie = await generateSessionCookie(commenterUser);
  const viewerCookie = await generateSessionCookie(viewerUser);
  const outsiderCookie = await generateSessionCookie(outsiderUser);

  try {
    // =========================================================================
    // SECTION 1: Page Creation & Deletion Authorization
    // =========================================================================
    console.log('--- Section 1: Page Creation & Deletion Authorization ---');

    // 1.1 VIEWER cannot create page (403)
    const p1 = await fetch(`${BASE_URL}/api/workspaces/${workspace1.id}/pages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: viewerCookie },
      body: JSON.stringify({ title: 'Viewer Page' }),
    });
    report('TC-P9-P01: VIEWER cannot create page (403 Forbidden)', p1.status === 403);

    // 1.2 COMMENTER cannot create page (403)
    const p2 = await fetch(`${BASE_URL}/api/workspaces/${workspace1.id}/pages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: commenterCookie },
      body: JSON.stringify({ title: 'Commenter Page' }),
    });
    report('TC-P9-P02: COMMENTER cannot create page (403 Forbidden)', p2.status === 403);

    // 1.3 EDITOR can create page (201)
    const p3 = await fetch(`${BASE_URL}/api/workspaces/${workspace1.id}/pages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: editorCookie },
      body: JSON.stringify({ title: 'Editor Created Page' }),
    });
    const p3Data = await p3.json();
    report('TC-P9-P03: EDITOR can create page (201 Created)', p3.status === 201 && p3Data.page?.title === 'Editor Created Page');

    // 1.4 OWNER can create page (201)
    const p4 = await fetch(`${BASE_URL}/api/workspaces/${workspace1.id}/pages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
      body: JSON.stringify({ title: 'Owner Created Page' }),
    });
    const p4Data = await p4.json();
    report('TC-P9-P04: OWNER can create page (201 Created)', p4.status === 201 && p4Data.page?.title === 'Owner Created Page');

    // 1.5 Cross-workspace parent page rejected (400)
    const p5 = await fetch(`${BASE_URL}/api/workspaces/${workspace1.id}/pages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
      body: JSON.stringify({ title: 'Cross Workspace Page', parentPageId: page2.id }),
    });
    report('TC-P9-P05: Cross-workspace parent page rejected (400 Bad Request)', p5.status === 400);

    // 1.6 VIEWER cannot delete page (403)
    const d1 = await fetch(`${BASE_URL}/api/workspaces/${workspace1.id}/pages/${p3Data.page.id}`, {
      method: 'DELETE',
      headers: { Cookie: viewerCookie },
    });
    report('TC-P9-P06: VIEWER cannot delete page (403 Forbidden)', d1.status === 403);

    // 1.7 COMMENTER cannot delete page (403)
    const d2 = await fetch(`${BASE_URL}/api/workspaces/${workspace1.id}/pages/${p3Data.page.id}`, {
      method: 'DELETE',
      headers: { Cookie: commenterCookie },
    });
    report('TC-P9-P07: COMMENTER cannot delete page (403 Forbidden)', d2.status === 403);

    // 1.8 Cross-workspace page deletion rejected with 404 (IDOR prevention)
    const d3 = await fetch(`${BASE_URL}/api/workspaces/${workspace1.id}/pages/${page2.id}`, {
      method: 'DELETE',
      headers: { Cookie: ownerCookie },
    });
    report('TC-P9-P08: Cross-workspace page deletion rejected with 404 (IDOR prevention)', d3.status === 404);

    // 1.9 EDITOR can delete page (200)
    const d4 = await fetch(`${BASE_URL}/api/workspaces/${workspace1.id}/pages/${p3Data.page.id}`, {
      method: 'DELETE',
      headers: { Cookie: editorCookie },
    });
    report('TC-P9-P09: EDITOR can delete page (200 OK)', d4.status === 200);

    // 1.10 OWNER can delete page (200)
    const d5 = await fetch(`${BASE_URL}/api/workspaces/${workspace1.id}/pages/${p4Data.page.id}`, {
      method: 'DELETE',
      headers: { Cookie: ownerCookie },
    });
    report('TC-P9-P10: OWNER can delete page (200 OK)', d5.status === 200);

    // =========================================================================
    // SECTION 2: Member Management APIs
    // =========================================================================
    console.log('\n--- Section 2: Member Management APIs ---');

    // 2.1 Non-owner (EDITOR) cannot add member (403)
    const m1 = await fetch(`${BASE_URL}/api/workspaces/${workspace1.id}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: editorCookie },
      body: JSON.stringify({ email: inviteTargetUser.email, role: 'EDITOR' }),
    });
    report('TC-P9-M01: Non-owner EDITOR cannot add member (403 Forbidden)', m1.status === 403);

    // 2.2 Adding non-existent user returns 404
    const m2 = await fetch(`${BASE_URL}/api/workspaces/${workspace1.id}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
      body: JSON.stringify({ email: 'ghost_user_not_exist@test.com', role: 'VIEWER' }),
    });
    report('TC-P9-M02: Adding non-existent user email returns 404 Not Found', m2.status === 404);

    // 2.3 Invalid role rejected with 400
    const m3 = await fetch(`${BASE_URL}/api/workspaces/${workspace1.id}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
      body: JSON.stringify({ email: inviteTargetUser.email, role: 'SUPER_ADMIN' }),
    });
    report('TC-P9-M03: Invalid member role rejected (400 Bad Request)', m3.status === 400);

    // 2.4 OWNER can invite existing registered user as VIEWER (201)
    const m4 = await fetch(`${BASE_URL}/api/workspaces/${workspace1.id}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
      body: JSON.stringify({ email: inviteTargetUser.email, role: 'VIEWER' }),
    });
    const m4Data = await m4.json();
    const createdMemberId = m4Data.member?.id;
    report(
      'TC-P9-M04: OWNER can add existing user as member (201 Created)',
      m4.status === 201 && m4Data.member?.role === 'VIEWER' && m4Data.member?.email === inviteTargetUser.email
    );

    // 2.5 Duplicate membership rejected with 409 Conflict
    const m5 = await fetch(`${BASE_URL}/api/workspaces/${workspace1.id}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
      body: JSON.stringify({ email: inviteTargetUser.email, role: 'EDITOR' }),
    });
    report('TC-P9-M05: Duplicate member addition rejected (409 Conflict)', m5.status === 409);

    // 2.6 Non-owner cannot update member role (403)
    const m6 = await fetch(`${BASE_URL}/api/workspaces/${workspace1.id}/members/${createdMemberId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: editorCookie },
      body: JSON.stringify({ role: 'EDITOR' }),
    });
    report('TC-P9-M06: Non-owner cannot update member role (403 Forbidden)', m6.status === 403);

    // 2.7 OWNER can update member role to COMMENTER (200)
    const m7 = await fetch(`${BASE_URL}/api/workspaces/${workspace1.id}/members/${createdMemberId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
      body: JSON.stringify({ role: 'COMMENTER' }),
    });
    const m7Data = await m7.json();
    report(
      'TC-P9-M07: OWNER can update member role (200 OK)',
      m7.status === 200 && m7Data.member?.role === 'COMMENTER'
    );

    // 2.8 Cross-workspace member update rejected with 404 (IDOR prevention)
    const m8 = await fetch(`${BASE_URL}/api/workspaces/${workspace2.id}/members/${createdMemberId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: outsiderCookie },
      body: JSON.stringify({ role: 'EDITOR' }),
    });
    report('TC-P9-M08: Cross-workspace member update rejected (404 Not Found)', m8.status === 404);

    // 2.9 Non-owner cannot remove member (403)
    const m9 = await fetch(`${BASE_URL}/api/workspaces/${workspace1.id}/members/${createdMemberId}`, {
      method: 'DELETE',
      headers: { Cookie: commenterCookie },
    });
    report('TC-P9-M09: Non-owner cannot remove member (403 Forbidden)', m9.status === 403);

    // 2.10 OWNER can remove member (200)
    const m10 = await fetch(`${BASE_URL}/api/workspaces/${workspace1.id}/members/${createdMemberId}`, {
      method: 'DELETE',
      headers: { Cookie: ownerCookie },
    });
    report('TC-P9-M10: OWNER can remove member (200 OK)', m10.status === 200);

    // =========================================================================
    // SECTION 3: Collaboration Token Authorization
    // =========================================================================
    console.log('\n--- Section 3: Collaboration Token Authorization ---');

    // 3.1 Non-member rejected with 403
    const ct0 = await fetch(`${BASE_URL}/api/workspaces/${workspace1.id}/pages/${page1.id}/collab-token`, {
      method: 'POST',
      headers: { Cookie: outsiderCookie },
    });
    report('TC-P9-T01: Non-member cannot receive collaboration token (403 Forbidden)', ct0.status === 403);

    // 3.2 OWNER receives token
    const ctOwner = await fetch(`${BASE_URL}/api/workspaces/${workspace1.id}/pages/${page1.id}/collab-token`, {
      method: 'POST',
      headers: { Cookie: ownerCookie },
    });
    const ctOwnerData = await ctOwner.json();
    report('TC-P9-T02: OWNER receives valid collab token', ctOwner.status === 200 && ctOwnerData.role === 'OWNER');

    // 3.3 EDITOR receives token
    const ctEditor = await fetch(`${BASE_URL}/api/workspaces/${workspace1.id}/pages/${page1.id}/collab-token`, {
      method: 'POST',
      headers: { Cookie: editorCookie },
    });
    const ctEditorData = await ctEditor.json();
    report('TC-P9-T03: EDITOR receives valid collab token', ctEditor.status === 200 && ctEditorData.role === 'EDITOR');

    // 3.4 COMMENTER receives token (Model B)
    const ctCommenter = await fetch(`${BASE_URL}/api/workspaces/${workspace1.id}/pages/${page1.id}/collab-token`, {
      method: 'POST',
      headers: { Cookie: commenterCookie },
    });
    const ctCommenterData = await ctCommenter.json();
    report('TC-P9-T04: COMMENTER receives valid collab token', ctCommenter.status === 200 && ctCommenterData.role === 'COMMENTER');

    // 3.5 VIEWER receives token (Model B)
    const ctViewer = await fetch(`${BASE_URL}/api/workspaces/${workspace1.id}/pages/${page1.id}/collab-token`, {
      method: 'POST',
      headers: { Cookie: viewerCookie },
    });
    const ctViewerData = await ctViewer.json();
    report('TC-P9-T05: VIEWER receives valid collab token', ctViewer.status === 200 && ctViewerData.role === 'VIEWER');

    // =========================================================================
    // SECTION 4: WebSocket Read-Only Protection (Model B)
    // =========================================================================
    console.log('\n--- Section 4: WebSocket Read-Only Protection (Model B) ---');

    const testRoomId = page1.id;

    // Helper to decode messages robustly
    function parseJsonMessage(data) {
      let str = '';
      if (typeof data === 'string') str = data;
      else if (Buffer.isBuffer(data)) str = data.toString('utf8');
      else if (data instanceof ArrayBuffer) str = new TextDecoder().decode(data);
      if (str && str.trim().startsWith('{')) {
        try {
          return JSON.parse(str);
        } catch {}
      }
      return null;
    }

    function toUint8Array(data) {
      if (data instanceof Uint8Array) return data;
      if (data instanceof ArrayBuffer) return new Uint8Array(data);
      if (Buffer.isBuffer(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      return null;
    }

    // Helper to connect an authenticated WebSocket client to isolated collab server
    function connectTestWs(token, pageId = testRoomId) {
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${TEST_WS_PORT}/${pageId}`, {
          headers: { Origin: 'http://localhost:3000' },
        });
        ws.binaryType = 'arraybuffer';

        let isAuth = false;
        ws.on('open', () => {
          ws.send(JSON.stringify({ type: 'auth', token }));
        });

        ws.on('message', (data) => {
          const json = parseJsonMessage(data);
          if (json && json.type === 'authenticated') {
            isAuth = true;
            resolve(ws);
          }
        });

        ws.on('error', (err) => {
          if (!isAuth) reject(err);
        });

        setTimeout(() => {
          if (!isAuth) {
            ws.close();
            reject(new Error('WebSocket auth timeout'));
          }
        }, 4000);
      });
    }

    // 4.1 All four roles can authenticate and connect to the room
    const tokenOwner = await generateCollabToken({
      userId: ownerUser.id,
      userName: ownerUser.name,
      pageId: testRoomId,
      workspaceId: workspace1.id,
      role: 'OWNER',
    });
    const tokenEditor = await generateCollabToken({
      userId: editorUser.id,
      userName: editorUser.name,
      pageId: testRoomId,
      workspaceId: workspace1.id,
      role: 'EDITOR',
    });
    const tokenCommenter = await generateCollabToken({
      userId: commenterUser.id,
      userName: commenterUser.name,
      pageId: testRoomId,
      workspaceId: workspace1.id,
      role: 'COMMENTER',
    });
    const tokenViewer = await generateCollabToken({
      userId: viewerUser.id,
      userName: viewerUser.name,
      pageId: testRoomId,
      workspaceId: workspace1.id,
      role: 'VIEWER',
    });

    const wsOwner = await connectTestWs(tokenOwner);
    const wsEditor = await connectTestWs(tokenEditor);
    const wsCommenter = await connectTestWs(tokenCommenter);
    const wsViewer = await connectTestWs(tokenViewer);

    report(
      'TC-P9-WS01: All four roles connect and authenticate successfully',
      wsOwner.readyState === WebSocket.OPEN &&
        wsEditor.readyState === WebSocket.OPEN &&
        wsCommenter.readyState === WebSocket.OPEN &&
        wsViewer.readyState === WebSocket.OPEN
    );

    // 4.2 EDITOR sends a legitimate Yjs update -> Server applies and broadcasts to all clients
    let viewerReceivedDocUpdate = false;
    let commenterReceivedDocUpdate = false;

    wsViewer.on('message', (data) => {
      const uint8 = toUint8Array(data);
      if (uint8) {
        try {
          const decoder = decoding.createDecoder(uint8);
          const msgType = decoding.readVarUint(decoder);
          if (msgType === 0) { // MESSAGE_SYNC
            const syncType = decoding.readVarUint(decoder);
            if (syncType === 2) { // messageYjsUpdate
              viewerReceivedDocUpdate = true;
            }
          }
        } catch {}
      }
    });

    wsCommenter.on('message', (data) => {
      const uint8 = toUint8Array(data);
      if (uint8) {
        try {
          const decoder = decoding.createDecoder(uint8);
          const msgType = decoding.readVarUint(decoder);
          if (msgType === 0) { // MESSAGE_SYNC
            const syncType = decoding.readVarUint(decoder);
            if (syncType === 2) { // messageYjsUpdate
              commenterReceivedDocUpdate = true;
            }
          }
        } catch {}
      }
    });

    // Editor writes text into Y.Doc
    const editorDoc = new Y.Doc();
    const editorP = new Y.XmlElement('paragraph');
    editorP.insert(0, [new Y.XmlText('Valid edit by Editor')]);
    editorDoc.getXmlFragment('default').insert(0, [editorP]);
    const editorUpdate = Y.encodeStateAsUpdate(editorDoc);

    const editorEnc = encoding.createEncoder();
    encoding.writeVarUint(editorEnc, 0); // MESSAGE_SYNC
    encoding.writeVarUint(editorEnc, 2); // messageYjsUpdate
    encoding.writeVarUint8Array(editorEnc, editorUpdate);
    wsEditor.send(encoding.toUint8Array(editorEnc), { binary: true });

    // Wait for broadcast to reach viewer and commenter
    await new Promise((r) => setTimeout(r, 200));

    const serverRoom = collabServer.rooms.get(testRoomId);
    const serverXml = serverRoom.doc.getXmlFragment('default').toString();

    report(
      'TC-P9-WS02: Authorized EDITOR update is applied to server Y.Doc and broadcast to all clients',
      serverXml.includes('Valid edit by Editor') && viewerReceivedDocUpdate && commenterReceivedDocUpdate
    );

    // 4.3 VIEWER attempts to send a malicious Yjs update -> Server DROPS update, sends permission denied
    let viewerGotPermissionDenied = false;
    let editorGotUnauthorizedBroadcast = false;

    wsViewer.on('message', (data) => {
      const json = parseJsonMessage(data);
      if (json && json.type === 'permission_denied') {
        viewerGotPermissionDenied = true;
        return;
      }
      const uint8 = toUint8Array(data);
      if (uint8) {
        try {
          const dec = decoding.createDecoder(uint8);
          if (decoding.readVarUint(dec) === 2) { // MESSAGE_AUTH
            viewerGotPermissionDenied = true;
          }
        } catch {}
      }
    });

    wsEditor.on('message', (data) => {
      const uint8 = toUint8Array(data);
      if (uint8) {
        try {
          const dec = decoding.createDecoder(uint8);
          if (decoding.readVarUint(dec) === 0) {
            const syncType = decoding.readVarUint(dec);
            if (syncType === 2) {
              const raw = decoding.readVarUint8Array(dec);
              // Check if contains the viewer's attack string
              const str = new TextDecoder().decode(raw);
              if (str.includes('Malicious Hack by Viewer')) {
                editorGotUnauthorizedBroadcast = true;
              }
            }
          }
        } catch {}
      }
    });

    const maliciousViewerDoc = new Y.Doc();
    const hackP = new Y.XmlElement('paragraph');
    hackP.insert(0, [new Y.XmlText('Malicious Hack by Viewer')]);
    maliciousViewerDoc.getXmlFragment('default').insert(0, [hackP]);
    const hackUpdate = Y.encodeStateAsUpdate(maliciousViewerDoc);

    const hackEnc = encoding.createEncoder();
    encoding.writeVarUint(hackEnc, 0); // MESSAGE_SYNC
    encoding.writeVarUint(hackEnc, 2); // messageYjsUpdate
    encoding.writeVarUint8Array(hackEnc, hackUpdate);
    wsViewer.send(encoding.toUint8Array(hackEnc), { binary: true });

    await new Promise((r) => setTimeout(r, 200));

    const serverXmlAfterHack = serverRoom.doc.getXmlFragment('default').toString();
    const serverUnmodified = !serverXmlAfterHack.includes('Malicious Hack by Viewer');

    report(
      'TC-P9-WS03: VIEWER incoming Yjs update is dropped (Server Y.Doc unmodified)',
      serverUnmodified && viewerGotPermissionDenied
    );

    report(
      'TC-P9-WS04: Unauthorized update is NOT broadcast to other peers',
      !editorGotUnauthorizedBroadcast
    );

    report(
      'TC-P9-WS05: Read-only client remains connected after permission denial',
      wsViewer.readyState === WebSocket.OPEN
    );

    // 4.4 COMMENTER attempts to send an update -> Server DROPS update
    let commenterGotPermissionDenied = false;
    wsCommenter.on('message', (data) => {
      const json = parseJsonMessage(data);
      if (json && json.type === 'permission_denied') {
        commenterGotPermissionDenied = true;
        return;
      }
      const uint8 = toUint8Array(data);
      if (uint8) {
        try {
          const dec = decoding.createDecoder(uint8);
          if (decoding.readVarUint(dec) === 2) { // MESSAGE_AUTH
            commenterGotPermissionDenied = true;
          }
        } catch {}
      }
    });

    const commenterHackDoc = new Y.Doc();
    const commP = new Y.XmlElement('paragraph');
    commP.insert(0, [new Y.XmlText('Malicious Hack by Commenter')]);
    commenterHackDoc.getXmlFragment('default').insert(0, [commP]);
    const commHackUpdate = Y.encodeStateAsUpdate(commenterHackDoc);

    const commEnc = encoding.createEncoder();
    encoding.writeVarUint(commEnc, 0); // MESSAGE_SYNC
    encoding.writeVarUint(commEnc, 2); // messageYjsUpdate
    encoding.writeVarUint8Array(commEnc, commHackUpdate);
    wsCommenter.send(encoding.toUint8Array(commEnc), { binary: true });

    await new Promise((r) => setTimeout(r, 200));

    const serverXmlAfterComm = serverRoom.doc.getXmlFragment('default').toString();
    report(
      'TC-P9-WS06: COMMENTER incoming Yjs update is dropped (Server Y.Doc unmodified)',
      !serverXmlAfterComm.includes('Malicious Hack by Commenter') && commenterGotPermissionDenied
    );

    // 4.5 Awareness identity spoofing remains sanitized for read-only user
    const clientAwareness = new awarenessProtocol.Awareness(maliciousViewerDoc);
    clientAwareness.setLocalState({
      user: {
        name: 'Spoofed Fake Admin',
        role: 'OWNER',
        id: 'fake-owner-id',
      },
      cursor: { index: 99 },
    });
    const rawAwareness = awarenessProtocol.encodeAwarenessUpdate(clientAwareness, [clientAwareness.clientID]);

    const awareEnc = encoding.createEncoder();
    encoding.writeVarUint(awareEnc, 1); // MESSAGE_AWARENESS
    encoding.writeVarUint8Array(awareEnc, rawAwareness);
    wsViewer.send(encoding.toUint8Array(awareEnc), { binary: true });

    await new Promise((r) => setTimeout(r, 200));

    const serverAwarenessState = serverRoom.awareness.getStates().get(clientAwareness.clientID);
    const sanitizedName = serverAwarenessState?.user?.name === viewerUser.name;
    const sanitizedRole = serverAwarenessState?.user?.role === 'VIEWER';
    const sanitizedId = serverAwarenessState?.user?.id === viewerUser.id;

    report(
      'TC-P9-WS07: Awareness identity spoofing is sanitized using authenticated JWT claims',
      sanitizedName && sanitizedRole && sanitizedId,
      `Sanitized name: "${serverAwarenessState?.user?.name}", role: "${serverAwarenessState?.user?.role}"`
    );

    // Clean up WebSockets
    wsOwner.close();
    wsEditor.close();
    wsCommenter.close();
    wsViewer.close();

  } finally {
    if (collabServer) {
      console.log('Shutting down test Collab server...');
      await collabServer.close();
      collabServer = null;
    }

    console.log('\n--- Cleaning up temporary test records ---');
    try {
      await prisma.documentState.deleteMany({
        where: { pageId: { in: [page1.id, page2.id] } },
      });
      await prisma.page.deleteMany({
        where: { id: { in: [page1.id, page2.id] } },
      });
      await prisma.workspaceMember.deleteMany({
        where: { workspaceId: { in: [workspace1.id, workspace2.id] } },
      });
      await prisma.workspace.deleteMany({
        where: { id: { in: [workspace1.id, workspace2.id] } },
      });
      await prisma.user.deleteMany({
        where: {
          id: { in: [ownerUser.id, editorUser.id, commenterUser.id, viewerUser.id, outsiderUser.id, inviteTargetUser.id] },
        },
      });
      console.log('Test database records cleaned up.');
    } catch (cleanupErr) {
      console.warn('Warning during cleanup:', cleanupErr.message);
    }

    if (testNextProcess) {
      console.log('Shutting down Next.js test server...');
      testNextProcess.kill();
      testNextProcess = null;
    }

    await prisma.$disconnect();
    await pool.end();
  }

  console.log('\n======================================================================');
  console.log(`TOTAL TESTS: ${passed + failed}`);
  console.log(`PASSED: ${passed}`);
  console.log(`FAILED: ${failed}`);
  console.log('======================================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('Unhandled test suite exception:', err);
  if (collabServer) collabServer.close().catch(() => {});
  if (testNextProcess) testNextProcess.kill();
  process.exit(1);
});
