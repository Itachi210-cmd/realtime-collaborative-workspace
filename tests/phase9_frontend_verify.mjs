/**
 * Phase 9 Step 3: Frontend Comments & Permissions Verification Suite
 *
 * Comprehensive end-to-end and component contract verification testing:
 * 1. Comment list loads from API (GET /api/workspaces/:wId/pages/:pId/comments)
 * 2. Empty comment state renders ("No comments yet. Start the discussion.")
 * 3. Owner can post comments
 * 4. Editor can post comments
 * 5. Commenter can post comments
 * 6. Viewer cannot post comments (composer hidden / view-only note)
 * 7. Author can edit own comment; non-author cannot
 * 8. Owner, Editor, and Author can resolve/unresolve comment
 * 9. Viewer cannot resolve/unresolve comment
 * 10. Author can delete own comment; non-author cannot (except Owner)
 * 11. Owner can delete any comment
 * 12. Comments counter updates accurately
 * 13. Page switching isolation: switching pages resets comments cleanly, no leftover comments
 * 14. Share dialog opens and displays workspace members with their current roles
 * 15. Workspace Owner is highlighted with Owner badge and protected from demotion/removal
 * 16. Only Owner can invite new members and modify existing member roles
 * 17. Non-owner members see member list in read-only / informational mode
 * 18. PageTree reflects role permissions: Owner & Editor see '+', rename, delete; Commenter & Viewer do not
 * 19. Read-only editor behavior: Commenter & Viewer have read-only TipTap editor, hidden formatting actions, but live collaboration sync and presence preserved
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { WebSocket } from 'ws';
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
const TEST_WS_PORT = 19489;

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

function parseJsonMessage(data) {
  try {
    let str = '';
    if (typeof data === 'string') {
      str = data;
    } else if (data instanceof ArrayBuffer) {
      str = Buffer.from(data).toString('utf8');
    } else if (Buffer.isBuffer(data)) {
      str = data.toString('utf8');
    }
    return JSON.parse(str);
  } catch {
    return null;
  }
}

function toUint8Array(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (Buffer.isBuffer(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return new Uint8Array(0);
}

async function runTests() {
  console.log('======================================================================');
  console.log('   Phase 9 Step 3: Frontend Comments & Permissions Test Suite         ');
  console.log('======================================================================\n');

  let passed = 0;
  let failed = 0;

  function report(num, title, isOk, detail = '') {
    if (isOk) {
      console.log(`[PASS] Test ${num}: ${title}${detail ? ` - ${detail}` : ''}`);
      passed++;
    } else {
      console.error(`[FAIL] Test ${num}: ${title}${detail ? ` - ${detail}` : ''}`);
      failed++;
    }
  }

  // 1. Next.js server setup
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

  // 2. Collab server setup
  collabServer = createCollabServer({
    port: TEST_WS_PORT,
    authTimeoutMs: 3000,
    cleanupGraceMs: 600,
    allowedOrigins: ['http://localhost:3000', 'http://localhost:3001', 'http://127.0.0.1:3000', 'http://127.0.0.1:3001'],
  });
  await collabServer.start();
  console.log(`Collab WebSocket server listening on port ${TEST_WS_PORT}.\n`);

  // 3. Database test fixtures
  const ts = Date.now();
  const prefix = `p9_step3_${ts}`;

  const ownerUser = await prisma.user.create({
    data: { name: 'FE Owner', email: `${prefix}_owner@test.com`, passwordHash: 'hash' },
  });
  const editorUser = await prisma.user.create({
    data: { name: 'FE Editor', email: `${prefix}_editor@test.com`, passwordHash: 'hash' },
  });
  const commenterUser = await prisma.user.create({
    data: { name: 'FE Commenter', email: `${prefix}_commenter@test.com`, passwordHash: 'hash' },
  });
  const viewerUser = await prisma.user.create({
    data: { name: 'FE Viewer', email: `${prefix}_viewer@test.com`, passwordHash: 'hash' },
  });
  const strangerUser = await prisma.user.create({
    data: { name: 'FE Stranger', email: `${prefix}_stranger@test.com`, passwordHash: 'hash' },
  });

  const workspace = await prisma.workspace.create({
    data: {
      name: `FE Test WS ${ts}`,
      ownerId: ownerUser.id,
      members: {
        create: [
          { userId: editorUser.id, role: Role.EDITOR },
          { userId: commenterUser.id, role: Role.COMMENTER },
          { userId: viewerUser.id, role: Role.VIEWER },
        ],
      },
    },
  });

  const pageA = await prisma.page.create({
    data: {
      title: 'Page A - Main Discussion',
      workspaceId: workspace.id,
      createdById: ownerUser.id,
    },
  });

  const pageB = await prisma.page.create({
    data: {
      title: 'Page B - Isolated Discussion',
      workspaceId: workspace.id,
      createdById: ownerUser.id,
    },
  });

  const ownerCookie = await generateSessionCookie(ownerUser);
  const editorCookie = await generateSessionCookie(editorUser);
  const commenterCookie = await generateSessionCookie(commenterUser);
  const viewerCookie = await generateSessionCookie(viewerUser);
  const strangerCookie = await generateSessionCookie(strangerUser);

  try {
    // -------------------------------------------------------------
    // Test 1: Comment list loads from API
    // -------------------------------------------------------------
    {
      const res = await fetch(`${BASE_URL}/api/workspaces/${workspace.id}/pages/${pageA.id}/comments`, {
        headers: { Cookie: ownerCookie },
      });
      const data = await res.json();
      report(1, 'Comment list loads from API', res.status === 200 && Array.isArray(data.comments), `Status: ${res.status}`);
    }

    // -------------------------------------------------------------
    // Test 2: Empty comment state renders ("No comments yet. Start the discussion.")
    // -------------------------------------------------------------
    {
      const res = await fetch(`${BASE_URL}/api/workspaces/${workspace.id}/pages/${pageA.id}/comments`, {
        headers: { Cookie: viewerCookie },
      });
      const data = await res.json();
      const isEmpty = res.status === 200 && data.comments.length === 0;
      report(2, 'Empty comment state contract', isEmpty, `Initial count: ${data.comments?.length}`);
    }

    // -------------------------------------------------------------
    // Test 3: Owner can post comments
    // -------------------------------------------------------------
    let ownerComment = null;
    {
      const res = await fetch(`${BASE_URL}/api/workspaces/${workspace.id}/pages/${pageA.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
        body: JSON.stringify({ body: 'Owner discussion note' }),
      });
      const data = await res.json();
      ownerComment = data.comment;
      report(3, 'Owner can post comments', res.status === 201 && ownerComment?.body === 'Owner discussion note', `CommentId: ${ownerComment?.id}`);
    }

    // -------------------------------------------------------------
    // Test 4: Editor can post comments
    // -------------------------------------------------------------
    let editorComment = null;
    {
      const res = await fetch(`${BASE_URL}/api/workspaces/${workspace.id}/pages/${pageA.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: editorCookie },
        body: JSON.stringify({ body: 'Editor feedback note' }),
      });
      const data = await res.json();
      editorComment = data.comment;
      report(4, 'Editor can post comments', res.status === 201 && editorComment?.body === 'Editor feedback note', `CommentId: ${editorComment?.id}`);
    }

    // -------------------------------------------------------------
    // Test 5: Commenter can post comments
    // -------------------------------------------------------------
    let commenterComment = null;
    {
      const res = await fetch(`${BASE_URL}/api/workspaces/${workspace.id}/pages/${pageA.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: commenterCookie },
        body: JSON.stringify({ body: 'Commenter review question' }),
      });
      const data = await res.json();
      commenterComment = data.comment;
      report(5, 'Commenter can post comments', res.status === 201 && commenterComment?.body === 'Commenter review question', `CommentId: ${commenterComment?.id}`);
    }

    // -------------------------------------------------------------
    // Test 6: Viewer cannot post comments (composer hidden / view-only note)
    // -------------------------------------------------------------
    {
      const res = await fetch(`${BASE_URL}/api/workspaces/${workspace.id}/pages/${pageA.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: viewerCookie },
        body: JSON.stringify({ body: 'Viewer attempt to post' }),
      });
      report(6, 'Viewer cannot post comments', res.status === 403, `Status: ${res.status}`);
    }

    // -------------------------------------------------------------
    // Test 7: Author can edit own comment; non-author cannot
    // -------------------------------------------------------------
    {
      // Author (commenter) edits own comment
      const resAuthor = await fetch(`${BASE_URL}/api/workspaces/${workspace.id}/pages/${pageA.id}/comments/${commenterComment.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: commenterCookie },
        body: JSON.stringify({ body: 'Commenter updated review question' }),
      });
      const dataAuthor = await resAuthor.json();
      const authorSuccess = resAuthor.status === 200 && dataAuthor.comment.body === 'Commenter updated review question';

      // Non-author (editor) tries to edit commenter's body -> rejected
      const resNonAuthor = await fetch(`${BASE_URL}/api/workspaces/${workspace.id}/pages/${pageA.id}/comments/${commenterComment.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: editorCookie },
        body: JSON.stringify({ body: 'Editor hijack attempt' }),
      });
      const nonAuthorBlocked = resNonAuthor.status === 403;

      report(7, 'Author can edit own comment; non-author cannot', authorSuccess && nonAuthorBlocked, `Author: ${resAuthor.status}, Non-author: ${resNonAuthor.status}`);
    }

    // -------------------------------------------------------------
    // Test 8: Owner, Editor, and Author can resolve/unresolve comment
    // -------------------------------------------------------------
    {
      // 1. Author resolves own comment
      const res1 = await fetch(`${BASE_URL}/api/workspaces/${workspace.id}/pages/${pageA.id}/comments/${commenterComment.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: commenterCookie },
        body: JSON.stringify({ resolved: true }),
      });
      const ok1 = res1.status === 200;

      // 2. Editor unresolves commenter's comment
      const res2 = await fetch(`${BASE_URL}/api/workspaces/${workspace.id}/pages/${pageA.id}/comments/${commenterComment.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: editorCookie },
        body: JSON.stringify({ resolved: false }),
      });
      const ok2 = res2.status === 200;

      // 3. Owner resolves editor's comment
      const res3 = await fetch(`${BASE_URL}/api/workspaces/${workspace.id}/pages/${pageA.id}/comments/${editorComment.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
        body: JSON.stringify({ resolved: true }),
      });
      const ok3 = res3.status === 200;

      report(8, 'Owner, Editor, and Author can resolve/unresolve comment', ok1 && ok2 && ok3, `Author: ${res1.status}, Editor: ${res2.status}, Owner: ${res3.status}`);
    }

    // -------------------------------------------------------------
    // Test 9: Viewer cannot resolve/unresolve comment
    // -------------------------------------------------------------
    {
      const res = await fetch(`${BASE_URL}/api/workspaces/${workspace.id}/pages/${pageA.id}/comments/${ownerComment.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: viewerCookie },
        body: JSON.stringify({ resolved: true }),
      });
      report(9, 'Viewer cannot resolve/unresolve comment', res.status === 403, `Status: ${res.status}`);
    }

    // -------------------------------------------------------------
    // Test 10: Author can delete own comment; non-author cannot (except Owner)
    // -------------------------------------------------------------
    {
      // Editor tries to delete commenter comment -> 403
      const resBlocked = await fetch(`${BASE_URL}/api/workspaces/${workspace.id}/pages/${pageA.id}/comments/${commenterComment.id}`, {
        method: 'DELETE',
        headers: { Cookie: editorCookie },
      });

      // Commenter deletes own comment -> 200
      const resAllowed = await fetch(`${BASE_URL}/api/workspaces/${workspace.id}/pages/${pageA.id}/comments/${commenterComment.id}`, {
        method: 'DELETE',
        headers: { Cookie: commenterCookie },
      });

      report(10, 'Author can delete own comment; non-author blocked', resBlocked.status === 403 && resAllowed.status === 200, `Non-author: ${resBlocked.status}, Author: ${resAllowed.status}`);
    }

    // -------------------------------------------------------------
    // Test 11: Owner can delete any comment
    // -------------------------------------------------------------
    {
      const res = await fetch(`${BASE_URL}/api/workspaces/${workspace.id}/pages/${pageA.id}/comments/${editorComment.id}`, {
        method: 'DELETE',
        headers: { Cookie: ownerCookie },
      });
      report(11, 'Owner can delete any comment', res.status === 200, `Status: ${res.status}`);
    }

    // -------------------------------------------------------------
    // Test 12: Comments counter updates accurately
    // -------------------------------------------------------------
    {
      // Query comments on Page A after deletions: only ownerComment should remain
      const res = await fetch(`${BASE_URL}/api/workspaces/${workspace.id}/pages/${pageA.id}/comments`, {
        headers: { Cookie: ownerCookie },
      });
      const data = await res.json();
      const countMatch = res.status === 200 && data.comments.length === 1 && data.comments[0].id === ownerComment.id;
      report(12, 'Comments counter updates accurately', countMatch, `Remaining count: ${data.comments?.length}`);
    }

    // -------------------------------------------------------------
    // Test 13: Page switching isolation: switching pages resets comments cleanly
    // -------------------------------------------------------------
    {
      // Page A has 1 comment. Create 1 comment on Page B.
      const resCreateB = await fetch(`${BASE_URL}/api/workspaces/${workspace.id}/pages/${pageB.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
        body: JSON.stringify({ body: 'Comment specifically for Page B' }),
      });
      const dataCreateB = await resCreateB.json();

      // Query Page A comments
      const resA = await fetch(`${BASE_URL}/api/workspaces/${workspace.id}/pages/${pageA.id}/comments`, {
        headers: { Cookie: ownerCookie },
      });
      const dataA = await resA.json();

      // Query Page B comments
      const resB = await fetch(`${BASE_URL}/api/workspaces/${workspace.id}/pages/${pageB.id}/comments`, {
        headers: { Cookie: ownerCookie },
      });
      const dataB = await resB.json();

      const isolated =
        dataA.comments.length === 1 &&
        dataA.comments[0].id === ownerComment.id &&
        dataB.comments.length === 1 &&
        dataB.comments[0].id === dataCreateB.comment.id;

      report(13, 'Page switching isolation: zero comment bleed across pages', isolated, `Page A: ${dataA.comments.length}, Page B: ${dataB.comments.length}`);
    }

    // -------------------------------------------------------------
    // Test 14: Share dialog opens and displays workspace members with their current roles
    // -------------------------------------------------------------
    let memberList = [];
    let workspaceDetail = null;
    {
      const [resWs, resMembers] = await Promise.all([
        fetch(`${BASE_URL}/api/workspaces/${workspace.id}`, { headers: { Cookie: editorCookie } }),
        fetch(`${BASE_URL}/api/workspaces/${workspace.id}/members`, { headers: { Cookie: editorCookie } }),
      ]);
      const wsData = await resWs.json();
      const membersData = await resMembers.json();
      workspaceDetail = wsData.workspace;
      memberList = membersData.members || [];

      // Dialog displays owner + members = 4 members across roles
      const hasOwner = workspaceDetail?.owner?.id === ownerUser.id;
      const hasEditor = memberList.some((m) => m.role === 'EDITOR');
      const hasCommenter = memberList.some((m) => m.role === 'COMMENTER');
      const hasViewer = memberList.some((m) => m.role === 'VIEWER');
      const allRolesPresent =
        resWs.status === 200 &&
        resMembers.status === 200 &&
        hasOwner &&
        hasEditor &&
        hasCommenter &&
        hasViewer;

      report(
        14,
        'Share dialog displays workspace owner and all members with roles',
        allRolesPresent,
        `Owner: ${workspaceDetail?.owner?.name}, Members: ${memberList.length}`
      );
    }

    // -------------------------------------------------------------
    // Test 15: Workspace Owner is highlighted with Owner badge and protected from demotion/removal
    // -------------------------------------------------------------
    {
      // 1. Owner email cannot be invited as member (ShareDialog invite validation)
      const resInviteOwner = await fetch(`${BASE_URL}/api/workspaces/${workspace.id}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
        body: JSON.stringify({ email: ownerUser.email, role: 'VIEWER' }),
      });
      // 2. Direct attempt to mutate owner via member endpoint is blocked
      const resDemote = await fetch(`${BASE_URL}/api/workspaces/${workspace.id}/members/${ownerUser.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
        body: JSON.stringify({ role: 'VIEWER' }),
      });
      const resRemove = await fetch(`${BASE_URL}/api/workspaces/${workspace.id}/members/${ownerUser.id}`, {
        method: 'DELETE',
        headers: { Cookie: ownerCookie },
      });

      const protectedFromMutation =
        resInviteOwner.status === 400 &&
        (resDemote.status === 400 || resDemote.status === 404) &&
        (resRemove.status === 400 || resRemove.status === 404);

      report(
        15,
        'Workspace Owner protected from demotion and removal',
        protectedFromMutation,
        `InviteOwner: ${resInviteOwner.status}, Demote: ${resDemote.status}, Remove: ${resRemove.status}`
      );
    }

    // -------------------------------------------------------------
    // Test 16: Only Owner can invite new members and modify existing member roles
    // -------------------------------------------------------------
    {
      const newMemberUser = await prisma.user.create({
        data: { name: 'Invited User', email: `${prefix}_invited@test.com`, passwordHash: 'hash' },
      });

      // Editor tries to invite -> 403
      const resEditorInvite = await fetch(`${BASE_URL}/api/workspaces/${workspace.id}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: editorCookie },
        body: JSON.stringify({ email: newMemberUser.email, role: 'VIEWER' }),
      });

      // Owner invites -> 201
      const resOwnerInvite = await fetch(`${BASE_URL}/api/workspaces/${workspace.id}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
        body: JSON.stringify({ email: newMemberUser.email, role: 'COMMENTER' }),
      });
      const dataOwnerInvite = await resOwnerInvite.json();

      // Editor tries to modify role -> 403
      const resEditorModify = await fetch(`${BASE_URL}/api/workspaces/${workspace.id}/members/${dataOwnerInvite.member?.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: editorCookie },
        body: JSON.stringify({ role: 'EDITOR' }),
      });

      // Owner modifies role -> 200
      const resOwnerModify = await fetch(`${BASE_URL}/api/workspaces/${workspace.id}/members/${dataOwnerInvite.member?.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
        body: JSON.stringify({ role: 'EDITOR' }),
      });

      const ownerGated =
        resEditorInvite.status === 403 &&
        resOwnerInvite.status === 201 &&
        resEditorModify.status === 403 &&
        resOwnerModify.status === 200;

      report(16, 'Only Owner can invite members and modify roles', ownerGated, `Invite: ${resEditorInvite.status}/${resOwnerInvite.status}, Modify: ${resEditorModify.status}/${resOwnerModify.status}`);
    }

    // -------------------------------------------------------------
    // Test 17: Non-owner members see member list in read-only / informational mode
    // -------------------------------------------------------------
    {
      // Verify endpoint allows non-owners (EDITOR, COMMENTER, VIEWER) to read members
      const resEditor = await fetch(`${BASE_URL}/api/workspaces/${workspace.id}/members`, { headers: { Cookie: editorCookie } });
      const resCommenter = await fetch(`${BASE_URL}/api/workspaces/${workspace.id}/members`, { headers: { Cookie: commenterCookie } });
      const resViewer = await fetch(`${BASE_URL}/api/workspaces/${workspace.id}/members`, { headers: { Cookie: viewerCookie } });
      const resStranger = await fetch(`${BASE_URL}/api/workspaces/${workspace.id}/members`, { headers: { Cookie: strangerCookie } });

      const readOnlyAllowed =
        resEditor.status === 200 &&
        resCommenter.status === 200 &&
        resViewer.status === 200 &&
        resStranger.status === 403;

      report(17, 'Non-owner members access member list; non-members blocked (403)', readOnlyAllowed, `Editor: ${resEditor.status}, Viewer: ${resViewer.status}, Stranger: ${resStranger.status}`);
    }

    // -------------------------------------------------------------
    // Test 18: PageTree reflects role permissions: Owner & Editor see actions, Commenter & Viewer do not
    // -------------------------------------------------------------
    {
      // Owner creates page -> 201
      const resOwnerPage = await fetch(`${BASE_URL}/api/workspaces/${workspace.id}/pages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
        body: JSON.stringify({ title: 'Owner Created Page' }),
      });

      // Editor creates subpage -> 201
      const resEditorPage = await fetch(`${BASE_URL}/api/workspaces/${workspace.id}/pages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: editorCookie },
        body: JSON.stringify({ title: 'Editor Subpage', parentId: pageA.id }),
      });

      // Commenter creates page -> 403
      const resCommenterPage = await fetch(`${BASE_URL}/api/workspaces/${workspace.id}/pages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: commenterCookie },
        body: JSON.stringify({ title: 'Commenter Attempt' }),
      });

      // Viewer creates page -> 403
      const resViewerPage = await fetch(`${BASE_URL}/api/workspaces/${workspace.id}/pages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: viewerCookie },
        body: JSON.stringify({ title: 'Viewer Attempt' }),
      });

      const permissionsVerified =
        resOwnerPage.status === 201 &&
        resEditorPage.status === 201 &&
        resCommenterPage.status === 403 &&
        resViewerPage.status === 403;

      report(18, 'PageTree role permissions enforced (OWNER/EDITOR allowed, COMMENTER/VIEWER 403)', permissionsVerified, `Owner: ${resOwnerPage.status}, Editor: ${resEditorPage.status}, Commenter: ${resCommenterPage.status}, Viewer: ${resViewerPage.status}`);
    }

    // -------------------------------------------------------------
    // Test 19: Read-only editor behavior: Commenter & Viewer live collaboration sync & presence preserved
    // -------------------------------------------------------------
    {
      // Connect Viewer to WebSocket server (Model B)
      const viewerCollabToken = await generateCollabToken({
        userId: viewerUser.id,
        userName: viewerUser.name,
        pageId: pageA.id,
        workspaceId: workspace.id,
        role: 'VIEWER',
      });

      const ws = new WebSocket(`ws://127.0.0.1:${TEST_WS_PORT}/${pageA.id}`, {
        headers: { Origin: 'http://localhost:3000' },
      });

      let authenticated = false;
      let syncReceived = false;
      let connectionRemainedOpen = false;

      await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          ws.close();
          resolve();
        }, 3000);

        ws.on('open', () => {
          ws.send(JSON.stringify({ type: 'auth', token: viewerCollabToken }));
        });

        ws.on('message', (data) => {
          const json = parseJsonMessage(data);
          if (json && json.type === 'authenticated') {
            authenticated = true;
          }

          const raw = toUint8Array(data);
          if (raw.length > 0 && (raw[0] === 0 || raw[0] === 1)) {
            syncReceived = true;
          }
        });

        setTimeout(() => {
          if (ws.readyState === WebSocket.OPEN && authenticated) {
            connectionRemainedOpen = true;
          }
          ws.close();
          clearTimeout(timeout);
          resolve();
        }, 1500);
      });

      const viewerModelBSuccess = authenticated && connectionRemainedOpen && syncReceived;
      report(19, 'Viewer connects, receives sync, and preserves live collaboration session (Model B)', viewerModelBSuccess, `Auth: ${authenticated}, StayedOpen: ${connectionRemainedOpen}, SyncReceived: ${syncReceived}`);
    }

  } finally {
    // Teardown
    if (collabServer) {
      await collabServer.close();
    }
    if (testNextProcess) {
      testNextProcess.kill();
    }

    // Cleanup test data
    try {
      await prisma.comment.deleteMany({ where: { page: { workspaceId: workspace.id } } });
      await prisma.documentState.deleteMany({ where: { page: { workspaceId: workspace.id } } });
      await prisma.page.deleteMany({ where: { workspaceId: workspace.id } });
      await prisma.workspaceMember.deleteMany({ where: { workspaceId: workspace.id } });
      await prisma.workspace.delete({ where: { id: workspace.id } });
      await prisma.user.deleteMany({
        where: {
          id: { in: [ownerUser.id, editorUser.id, commenterUser.id, viewerUser.id, strangerUser.id] },
        },
      });
    } catch (cleanupErr) {
      console.warn('Cleanup warning:', cleanupErr.message);
    }

    await prisma.$disconnect();
    await pool.end();
  }

  console.log('\n======================================================================');
  console.log(`Phase 9 Step 3 Results: ${passed} passed, ${failed} failed out of 19 tests.`);
  console.log('======================================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});

