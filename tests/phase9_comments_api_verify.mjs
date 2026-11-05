/**
 * Phase 9 Step 1: Comments API Verification Test Suite
 *
 * Verifies:
 * - Authenticated member can list comments.
 * - OWNER, EDITOR, and COMMENTER can create comments.
 * - VIEWER receives 403 when creating comments.
 * - Invalid and empty comment bodies are rejected.
 * - Client-supplied authorId is ignored (server binds strictly to session).
 * - Comment author can edit their own comment body.
 * - Unauthorized users cannot edit another user's comment body.
 * - Correct roles can resolve comments.
 * - COMMENTER cannot resolve another member's comment.
 * - Comment author and OWNER can delete comments.
 * - Unauthorized deletion receives 403.
 * - Cross-workspace comment access is rejected (404 IDOR prevention).
 * - Comments persist in PostgreSQL after reload.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { SignJWT } from 'jose';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Role } from '@prisma/client';

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

const pool = new pg.Pool({ connectionString: DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

let testServerProcess = null;
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

async function waitForServer(url, timeoutMs = 30000) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    try {
      const res = await fetch(`${url}/api/auth/me`);
      if (res.status === 401 || res.status === 200) {
        return true;
      }
    } catch {
      // Waiting for server to listen
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Server at ${url} did not become ready within ${timeoutMs}ms`);
}

async function runTests() {
  console.log('======================================================================');
  console.log('       Phase 9 Step 1: Comments API Verification Test Suite           ');
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
    testServerProcess = spawn(
      'npx',
      ['next', 'start', '-p', '3001'],
      { stdio: 'pipe', shell: true }
    );
    testServerProcess.stderr?.on('data', (d) => {
      const msg = d.toString();
      if (!msg.includes('middleware') && !msg.includes('ExperimentalWarning')) {
        // console.error('[Server stderr]', msg);
      }
    });
    await waitForServer(BASE_URL);
    console.log(`Next.js test server ready on ${BASE_URL}.\n`);
  }

  // 2. Setup Test Data in PostgreSQL
  const timestamp = Date.now();
  const testEmailPrefix = `p9_test_${timestamp}`;

  const ownerUser = await prisma.user.create({
    data: {
      name: 'P9 Owner',
      email: `${testEmailPrefix}_owner@test.com`,
      passwordHash: 'testhash',
    },
  });

  const editorUser = await prisma.user.create({
    data: {
      name: 'P9 Editor',
      email: `${testEmailPrefix}_editor@test.com`,
      passwordHash: 'testhash',
    },
  });

  const commenterUser = await prisma.user.create({
    data: {
      name: 'P9 Commenter',
      email: `${testEmailPrefix}_commenter@test.com`,
      passwordHash: 'testhash',
    },
  });

  const viewerUser = await prisma.user.create({
    data: {
      name: 'P9 Viewer',
      email: `${testEmailPrefix}_viewer@test.com`,
      passwordHash: 'testhash',
    },
  });

  const outsiderUser = await prisma.user.create({
    data: {
      name: 'P9 Outsider',
      email: `${testEmailPrefix}_outsider@test.com`,
      passwordHash: 'testhash',
    },
  });

  const workspace1 = await prisma.workspace.create({
    data: {
      name: `P9 Workspace 1 ${timestamp}`,
      ownerId: ownerUser.id,
    },
  });

  await prisma.workspaceMember.createMany({
    data: [
      { workspaceId: workspace1.id, userId: editorUser.id, role: Role.EDITOR },
      { workspaceId: workspace1.id, userId: commenterUser.id, role: Role.COMMENTER },
      { workspaceId: workspace1.id, userId: viewerUser.id, role: Role.VIEWER },
    ],
  });

  const page1 = await prisma.page.create({
    data: {
      title: 'P9 Test Page 1',
      workspaceId: workspace1.id,
      createdById: ownerUser.id,
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
    },
  });

  const workspace2 = await prisma.workspace.create({
    data: {
      name: `P9 Workspace 2 ${timestamp}`,
      ownerId: outsiderUser.id,
    },
  });

  const page2 = await prisma.page.create({
    data: {
      title: 'P9 Test Page 2',
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

  let createdCommenterComment = null;
  let createdEditorComment = null;
  let createdOwnerComment = null;

  try {
    // ------------------------------------------------------------------
    // Test 1: Unauthenticated request to GET comments receives 401
    // ------------------------------------------------------------------
    const res1 = await fetch(`${BASE_URL}/api/workspaces/${workspace1.id}/pages/${page1.id}/comments`);
    report('TC-P9-01: Unauthenticated request to GET comments returns 401', res1.status === 401);

    // ------------------------------------------------------------------
    // Test 2: Outsider (non-member) receives 403 on GET comments
    // ------------------------------------------------------------------
    const res2 = await fetch(`${BASE_URL}/api/workspaces/${workspace1.id}/pages/${page1.id}/comments`, {
      headers: { Cookie: outsiderCookie },
    });
    report('TC-P9-02: Non-member request to GET comments returns 403', res2.status === 403);

    // ------------------------------------------------------------------
    // Test 3: Authenticated VIEWER can list comments (empty initially)
    // ------------------------------------------------------------------
    const res3 = await fetch(`${BASE_URL}/api/workspaces/${workspace1.id}/pages/${page1.id}/comments`, {
      headers: { Cookie: viewerCookie },
    });
    const data3 = await res3.json();
    report(
      'TC-P9-03: Authenticated member (VIEWER) can list comments',
      res3.status === 200 && Array.isArray(data3.comments) && data3.comments.length === 0
    );

    // ------------------------------------------------------------------
    // Test 4: VIEWER receives 403 when trying to POST a comment
    // ------------------------------------------------------------------
    const res4 = await fetch(`${BASE_URL}/api/workspaces/${workspace1.id}/pages/${page1.id}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: viewerCookie },
      body: JSON.stringify({ body: 'Viewer attempting to comment' }),
    });
    report('TC-P9-04: VIEWER receives 403 when creating comment', res4.status === 403);

    // ------------------------------------------------------------------
    // Test 5: Empty / whitespace-only comment body is rejected with 400
    // ------------------------------------------------------------------
    const res5a = await fetch(`${BASE_URL}/api/workspaces/${workspace1.id}/pages/${page1.id}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: editorCookie },
      body: JSON.stringify({ body: '' }),
    });
    const res5b = await fetch(`${BASE_URL}/api/workspaces/${workspace1.id}/pages/${page1.id}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: editorCookie },
      body: JSON.stringify({ body: '     ' }),
    });
    report('TC-P9-05: Empty and whitespace comment body rejected with 400', res5a.status === 400 && res5b.status === 400);

    // ------------------------------------------------------------------
    // Test 6: Comment body exceeding 2000 chars is rejected with 400
    // ------------------------------------------------------------------
    const longBody = 'A'.repeat(2001);
    const res6 = await fetch(`${BASE_URL}/api/workspaces/${workspace1.id}/pages/${page1.id}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: editorCookie },
      body: JSON.stringify({ body: longBody }),
    });
    report('TC-P9-06: Comment body exceeding 2000 characters rejected with 400', res6.status === 400);

    // ------------------------------------------------------------------
    // Test 7: COMMENTER can create comment & client-supplied authorId is ignored
    // ------------------------------------------------------------------
    const res7 = await fetch(`${BASE_URL}/api/workspaces/${workspace1.id}/pages/${page1.id}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: commenterCookie },
      body: JSON.stringify({
        body: 'Initial comment from Commenter',
        authorId: 'spoofed-hacker-id',
        anchor: { blockId: 'block-1' },
      }),
    });
    const data7 = await res7.json();
    createdCommenterComment = data7.comment;
    const authorIsCommenter = data7.comment?.author?.id === commenterUser.id;
    const authorNotSpoofed = data7.comment?.authorId !== 'spoofed-hacker-id';
    report(
      'TC-P9-07: COMMENTER can create comment & client-supplied authorId is ignored',
      res7.status === 201 && authorIsCommenter && authorNotSpoofed,
      `author: ${data7.comment?.author?.name}`
    );

    // ------------------------------------------------------------------
    // Test 8: EDITOR can create comment
    // ------------------------------------------------------------------
    const res8 = await fetch(`${BASE_URL}/api/workspaces/${workspace1.id}/pages/${page1.id}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: editorCookie },
      body: JSON.stringify({ body: 'Review feedback from Editor' }),
    });
    const data8 = await res8.json();
    createdEditorComment = data8.comment;
    report('TC-P9-08: EDITOR can create comment', res8.status === 201 && data8.comment?.author?.id === editorUser.id);

    // ------------------------------------------------------------------
    // Test 9: OWNER can create comment
    // ------------------------------------------------------------------
    const res9 = await fetch(`${BASE_URL}/api/workspaces/${workspace1.id}/pages/${page1.id}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
      body: JSON.stringify({ body: 'Direction from Owner' }),
    });
    const data9 = await res9.json();
    createdOwnerComment = data9.comment;
    report('TC-P9-09: OWNER can create comment', res9.status === 201 && data9.comment?.author?.id === ownerUser.id);

    // ------------------------------------------------------------------
    // Test 10: GET comments returns all comments sorted ascending with author
    // ------------------------------------------------------------------
    const res10 = await fetch(`${BASE_URL}/api/workspaces/${workspace1.id}/pages/${page1.id}/comments`, {
      headers: { Cookie: viewerCookie },
    });
    const data10 = await res10.json();
    const countOk = data10.comments?.length === 3;
    const orderOk =
      new Date(data10.comments[0].createdAt) <= new Date(data10.comments[1].createdAt) &&
      new Date(data10.comments[1].createdAt) <= new Date(data10.comments[2].createdAt);
    const hasAuthorDetails = data10.comments.every((c) => c.author && c.author.name && c.author.email);
    report('TC-P9-10: GET comments returns comments sorted ascending with author details', countOk && orderOk && hasAuthorDetails);

    // ------------------------------------------------------------------
    // Test 11: Comment author can edit their own comment body
    // ------------------------------------------------------------------
    const res11 = await fetch(
      `${BASE_URL}/api/workspaces/${workspace1.id}/pages/${page1.id}/comments/${createdCommenterComment.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: commenterCookie },
        body: JSON.stringify({ body: 'Updated comment text from Commenter' }),
      }
    );
    const data11 = await res11.json();
    report(
      'TC-P9-11: Comment author can edit own comment body',
      res11.status === 200 && data11.comment?.body === 'Updated comment text from Commenter'
    );

    // ------------------------------------------------------------------
    // Test 12: Non-author (EDITOR) receives 403 when attempting to edit COMMENTER body
    // ------------------------------------------------------------------
    const res12 = await fetch(
      `${BASE_URL}/api/workspaces/${workspace1.id}/pages/${page1.id}/comments/${createdCommenterComment.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: editorCookie },
        body: JSON.stringify({ body: 'Malicious body edit by Editor' }),
      }
    );
    report('TC-P9-12: Non-author cannot edit another user comment body (403)', res12.status === 403);

    // ------------------------------------------------------------------
    // Test 13: COMMENTER receives 403 when trying to resolve another user's comment
    // ------------------------------------------------------------------
    const res13 = await fetch(
      `${BASE_URL}/api/workspaces/${workspace1.id}/pages/${page1.id}/comments/${createdEditorComment.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: commenterCookie },
        body: JSON.stringify({ resolved: true }),
      }
    );
    report('TC-P9-13: COMMENTER cannot resolve another member comment (403)', res13.status === 403);

    // ------------------------------------------------------------------
    // Test 14: Comment author (COMMENTER) CAN resolve their own comment
    // ------------------------------------------------------------------
    const res14 = await fetch(
      `${BASE_URL}/api/workspaces/${workspace1.id}/pages/${page1.id}/comments/${createdCommenterComment.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: commenterCookie },
        body: JSON.stringify({ resolved: true }),
      }
    );
    const data14 = await res14.json();
    report('TC-P9-14: Comment author can resolve their own comment', res14.status === 200 && data14.comment?.resolvedAt !== null);

    // ------------------------------------------------------------------
    // Test 15: EDITOR can resolve another user's comment
    // ------------------------------------------------------------------
    const res15 = await fetch(
      `${BASE_URL}/api/workspaces/${workspace1.id}/pages/${page1.id}/comments/${createdOwnerComment.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: editorCookie },
        body: JSON.stringify({ resolved: true }),
      }
    );
    const data15 = await res15.json();
    report('TC-P9-15: EDITOR can resolve another member comment', res15.status === 200 && data15.comment?.resolvedAt !== null);

    // ------------------------------------------------------------------
    // Test 16: OWNER can resolve any comment
    // ------------------------------------------------------------------
    const res16 = await fetch(
      `${BASE_URL}/api/workspaces/${workspace1.id}/pages/${page1.id}/comments/${createdEditorComment.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
        body: JSON.stringify({ resolved: true }),
      }
    );
    const data16 = await res16.json();
    report('TC-P9-16: OWNER can resolve any member comment', res16.status === 200 && data16.comment?.resolvedAt !== null);

    // ------------------------------------------------------------------
    // Test 17: Non-author (EDITOR) receives 403 when trying to delete COMMENTER comment
    // ------------------------------------------------------------------
    const res17 = await fetch(
      `${BASE_URL}/api/workspaces/${workspace1.id}/pages/${page1.id}/comments/${createdCommenterComment.id}`,
      {
        method: 'DELETE',
        headers: { Cookie: editorCookie },
      }
    );
    report('TC-P9-17: Non-author EDITOR receives 403 when deleting COMMENTER comment', res17.status === 403);

    // ------------------------------------------------------------------
    // Test 18: Comment author (COMMENTER) can delete their own comment
    // ------------------------------------------------------------------
    const res18 = await fetch(
      `${BASE_URL}/api/workspaces/${workspace1.id}/pages/${page1.id}/comments/${createdCommenterComment.id}`,
      {
        method: 'DELETE',
        headers: { Cookie: commenterCookie },
      }
    );
    report('TC-P9-18: Comment author can delete own comment (200)', res18.status === 200);

    // ------------------------------------------------------------------
    // Test 19: OWNER can delete another member's comment
    // ------------------------------------------------------------------
    const res19 = await fetch(
      `${BASE_URL}/api/workspaces/${workspace1.id}/pages/${page1.id}/comments/${createdEditorComment.id}`,
      {
        method: 'DELETE',
        headers: { Cookie: ownerCookie },
      }
    );
    report('TC-P9-19: Workspace OWNER can delete another member comment (200)', res19.status === 200);

    // ------------------------------------------------------------------
    // Test 20: Cross-workspace IDOR protection (returns 404)
    // ------------------------------------------------------------------
    // Attempt to access page2 (in workspace2) through workspace1 URL
    const res20a = await fetch(`${BASE_URL}/api/workspaces/${workspace1.id}/pages/${page2.id}/comments`, {
      headers: { Cookie: ownerCookie },
    });
    // Attempt to access createdOwnerComment using workspace2 URL
    const res20b = await fetch(
      `${BASE_URL}/api/workspaces/${workspace2.id}/pages/${page1.id}/comments/${createdOwnerComment.id}`,
      {
        method: 'DELETE',
        headers: { Cookie: outsiderCookie },
      }
    );
    report('TC-P9-20: Cross-workspace comment access rejected with 404 (IDOR prevention)', res20a.status === 404 && res20b.status === 404);

    // ------------------------------------------------------------------
    // Test 21: Comments persist in PostgreSQL after reload
    // ------------------------------------------------------------------
    const dbOwnerComment = await prisma.comment.findUnique({
      where: { id: createdOwnerComment.id },
      include: { author: true },
    });
    report(
      'TC-P9-21: Comment persists in PostgreSQL database with correct relations',
      dbOwnerComment !== null &&
        dbOwnerComment.body === 'Direction from Owner' &&
        dbOwnerComment.author.email === ownerUser.email &&
        dbOwnerComment.resolvedAt !== null
    );

  } finally {
    // Clean up test records
    console.log('\n--- Cleaning up temporary test records ---');
    try {
      await prisma.comment.deleteMany({
        where: { pageId: { in: [page1.id, page2.id] } },
      });
      await prisma.page.deleteMany({
        where: { id: { in: [page1.id, page2.id] } },
      });
      await prisma.workspaceMember.deleteMany({
        where: { workspaceId: workspace1.id },
      });
      await prisma.workspace.deleteMany({
        where: { id: { in: [workspace1.id, workspace2.id] } },
      });
      await prisma.user.deleteMany({
        where: {
          id: { in: [ownerUser.id, editorUser.id, commenterUser.id, viewerUser.id, outsiderUser.id] },
        },
      });
      console.log('Test cleanup complete.');
    } catch (cleanupErr) {
      console.warn('Warning during cleanup:', cleanupErr.message);
    }

    if (testServerProcess) {
      console.log('Shutting down Next.js test server...');
      testServerProcess.kill();
      testServerProcess = null;
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
  if (testServerProcess) testServerProcess.kill();
  process.exit(1);
});

