/**
 * Phase 10 Step 4: Restore API Verification Test Suite
 *
 * Verifies:
 * 1. Authentication enforcement (401 for missing session cookie).
 * 2. Workspace membership verification (403 for non-members).
 * 3. Cross-workspace IDOR protection (404 when pageId doesn't belong to workspace).
 * 4. Cross-page IDOR protection (404 when versionId doesn't belong to pageId).
 * 5. Non-existent snapshot handling (404 when versionId does not exist).
 * 6. Role-based restoration permissions:
 *    - VIEWER cannot restore (403 Forbidden).
 *    - COMMENTER cannot restore (403 Forbidden).
 *    - EDITOR can restore (200 OK).
 *    - OWNER can restore (200 OK).
 * 7. Automatic recovery snapshot generation returned in response payload.
 * 8. PostgreSQL DocumentState updated with restored state.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert';
import { SignJWT } from 'jose';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Role } from '@prisma/client';
import * as Y from 'yjs';
import * as yTiptap from '@tiptap/y-tiptap';
import {
  saveDocumentState,
  loadDocumentState,
  closePersistence,
} from '../src/server/collab-persistence.mjs';
import { createVersionSnapshot } from '../src/server/version-snapshot-service.mjs';

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

async function waitForServer(url, timeoutMs = 40000) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    try {
      const res = await fetch(`${url}/api/auth/me`);
      if (res.status === 401 || res.status === 200) {
        return true;
      }
    } catch {
      // Waiting for server to respond
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Server at ${url} did not become ready within ${timeoutMs}ms`);
}

async function runTests() {
  console.log('\n======================================================================');
  console.log('    Phase 10 Step 4: Version Restore HTTP API Verification Suite     ');
  console.log('======================================================================\n');

  let passed = 0;
  let failed = 0;

  function report(title, isOk, detail = '') {
    if (isOk) {
      console.log(`  [PASS] ${title}${detail ? ` - ${detail}` : ''}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${title}${detail ? ` - ${detail}` : ''}`);
      failed++;
    }
  }

  // Check or start Next.js test server
  const is3000Up = await fetch('http://localhost:3000/api/auth/me')
    .then((r) => r.status === 401 || r.status === 200)
    .catch(() => false);

  if (is3000Up) {
    BASE_URL = 'http://localhost:3000';
    console.log(`Connecting to existing Next.js server on ${BASE_URL}...`);
  } else {
    BASE_URL = 'http://localhost:3002';
    console.log(`Starting Next.js test server on ${BASE_URL}...`);
    testServerProcess = spawn(
      'npx',
      ['next', 'start', '-p', '3002'],
      { stdio: 'pipe', shell: true }
    );
    await waitForServer(BASE_URL);
    console.log(`Next.js test server ready on ${BASE_URL}\n`);
  }

  // Set up test users & roles
  const timestamp = Date.now();
  const owner = await prisma.user.create({
    data: {
      email: `owner_${timestamp}@example.com`,
      name: 'Owner User',
      passwordHash: 'irrelevant',
    },
  });

  const editor = await prisma.user.create({
    data: {
      email: `editor_${timestamp}@example.com`,
      name: 'Editor User',
      passwordHash: 'irrelevant',
    },
  });

  const commenter = await prisma.user.create({
    data: {
      email: `commenter_${timestamp}@example.com`,
      name: 'Commenter User',
      passwordHash: 'irrelevant',
    },
  });

  const viewer = await prisma.user.create({
    data: {
      email: `viewer_${timestamp}@example.com`,
      name: 'Viewer User',
      passwordHash: 'irrelevant',
    },
  });

  const stranger = await prisma.user.create({
    data: {
      email: `stranger_${timestamp}@example.com`,
      name: 'Stranger User',
      passwordHash: 'irrelevant',
    },
  });

  const cookieOwner = await generateSessionCookie(owner);
  const cookieEditor = await generateSessionCookie(editor);
  const cookieCommenter = await generateSessionCookie(commenter);
  const cookieViewer = await generateSessionCookie(viewer);
  const cookieStranger = await generateSessionCookie(stranger);

  // Setup Workspace & Memberships
  const workspaceA = await prisma.workspace.create({
    data: {
      name: 'Restore Workspace A',
      ownerId: owner.id,
      members: {
        create: [
          { userId: editor.id, role: Role.EDITOR },
          { userId: commenter.id, role: Role.COMMENTER },
          { userId: viewer.id, role: Role.VIEWER },
        ],
      },
    },
  });

  const workspaceB = await prisma.workspace.create({
    data: {
      name: 'Isolated Workspace B',
      ownerId: stranger.id,
    },
  });

  // Setup Pages
  const page1 = await prisma.page.create({
    data: {
      title: 'Target Document Page 1',
      workspaceId: workspaceA.id,
      createdById: owner.id,
    },
  });

  const page2 = await prisma.page.create({
    data: {
      title: 'Isolated Page in Workspace A',
      workspaceId: workspaceA.id,
      createdById: owner.id,
    },
  });

  const pageB = await prisma.page.create({
    data: {
      title: 'Foreign Page in Workspace B',
      workspaceId: workspaceB.id,
      createdById: stranger.id,
    },
  });

  // Create Snapshot 1 on Page 1 (Historical Version)
  const docV1 = new Y.Doc();
  const p1 = new Y.XmlElement('paragraph');
  p1.insert(0, [new Y.XmlText('Historical Snapshot Content V1')]);
  docV1.getXmlFragment('default').insert(0, [p1]);
  await saveDocumentState(page1.id, docV1);

  const snapshot1 = await createVersionSnapshot(page1.id, {
    userId: owner.id,
    label: 'Sprint 1 Baseline',
    description: 'Initial stable state',
    doc: docV1,
  });

  // Mutate Page 1 to V2
  const docV2 = new Y.Doc();
  const p2 = new Y.XmlElement('paragraph');
  p2.insert(0, [new Y.XmlText('Current Edited Content V2 before restore')]);
  docV2.getXmlFragment('default').insert(0, [p2]);
  await saveDocumentState(page1.id, docV2);

  // Create Snapshot on Page 2 for cross-page test
  const snapshotPage2 = await createVersionSnapshot(page2.id, {
    userId: owner.id,
    label: 'Page 2 Snapshot',
  });

  console.log('--- Section 1: Authentication & IDOR Verification ---');

  // Test 1: Unauthenticated request rejected with 401
  try {
    const res = await fetch(
      `${BASE_URL}/api/workspaces/${workspaceA.id}/pages/${page1.id}/versions/${snapshot1.id}/restore`,
      { method: 'POST' }
    );
    report('1. Missing session cookie returns 401 Unauthorized', res.status === 401);
  } catch (err) {
    report('1. Missing session cookie returns 401 Unauthorized', false, err.message);
  }

  // Test 2: Non-member rejected with 403
  try {
    const res = await fetch(
      `${BASE_URL}/api/workspaces/${workspaceA.id}/pages/${page1.id}/versions/${snapshot1.id}/restore`,
      {
        method: 'POST',
        headers: { Cookie: cookieStranger },
      }
    );
    report('2. Non-member user returns 403 Forbidden', res.status === 403);
  } catch (err) {
    report('2. Non-member user returns 403 Forbidden', false, err.message);
  }

  // Test 3: Cross-workspace IDOR (page1 in workspaceB URL)
  try {
    const res = await fetch(
      `${BASE_URL}/api/workspaces/${workspaceB.id}/pages/${page1.id}/versions/${snapshot1.id}/restore`,
      {
        method: 'POST',
        headers: { Cookie: cookieStranger },
      }
    );
    report('3. Cross-workspace document IDOR returns 404', res.status === 404);
  } catch (err) {
    report('3. Cross-workspace document IDOR returns 404', false, err.message);
  }

  // Test 4: Cross-page IDOR (snapshotPage2 requested on page1)
  try {
    const res = await fetch(
      `${BASE_URL}/api/workspaces/${workspaceA.id}/pages/${page1.id}/versions/${snapshotPage2.id}/restore`,
      {
        method: 'POST',
        headers: { Cookie: cookieOwner },
      }
    );
    report('4. Cross-page snapshot IDOR returns 404', res.status === 404);
  } catch (err) {
    report('4. Cross-page snapshot IDOR returns 404', false, err.message);
  }

  // Test 5: Non-existent snapshot ID returns 404
  try {
    const res = await fetch(
      `${BASE_URL}/api/workspaces/${workspaceA.id}/pages/${page1.id}/versions/cuid_non_existent_snapshot/restore`,
      {
        method: 'POST',
        headers: { Cookie: cookieOwner },
      }
    );
    report('5. Non-existent snapshot ID returns 404', res.status === 404);
  } catch (err) {
    report('5. Non-existent snapshot ID returns 404', false, err.message);
  }

  console.log('\n--- Section 2: Role-Based Authorization (RBAC) ---');

  // Test 6: VIEWER role receives 403 Forbidden
  try {
    const res = await fetch(
      `${BASE_URL}/api/workspaces/${workspaceA.id}/pages/${page1.id}/versions/${snapshot1.id}/restore`,
      {
        method: 'POST',
        headers: { Cookie: cookieViewer },
      }
    );
    const body = await res.json();
    const isOk = res.status === 403 && body.error?.includes('owners and editors');
    report('6. VIEWER role rejected with 403 Forbidden', isOk);
  } catch (err) {
    report('6. VIEWER role rejected with 403 Forbidden', false, err.message);
  }

  // Test 7: COMMENTER role receives 403 Forbidden
  try {
    const res = await fetch(
      `${BASE_URL}/api/workspaces/${workspaceA.id}/pages/${page1.id}/versions/${snapshot1.id}/restore`,
      {
        method: 'POST',
        headers: { Cookie: cookieCommenter },
      }
    );
    const body = await res.json();
    const isOk = res.status === 403 && body.error?.includes('owners and editors');
    report('7. COMMENTER role rejected with 403 Forbidden', isOk);
  } catch (err) {
    report('7. COMMENTER role rejected with 403 Forbidden', false, err.message);
  }

  // Test 8: EDITOR role allowed to restore (200 OK)
  try {
    const res = await fetch(
      `${BASE_URL}/api/workspaces/${workspaceA.id}/pages/${page1.id}/versions/${snapshot1.id}/restore`,
      {
        method: 'POST',
        headers: { Cookie: cookieEditor },
      }
    );
    const body = await res.json();
    const isOk =
      res.status === 200 &&
      body.success === true &&
      body.restoredVersion?.id === snapshot1.id &&
      body.recoverySnapshot &&
      body.recoverySnapshot.isAutomatic === true;
    report('8. EDITOR role successfully restores document (200 OK)', isOk);

    // Verify recovery snapshot created in DB
    const recoverySnap = await prisma.versionSnapshot.findUnique({
      where: { id: body.recoverySnapshot.id },
    });
    assert.ok(recoverySnap, 'Recovery snapshot must exist in PostgreSQL');
    assert.strictEqual(recoverySnap.isAutomatic, true);

    // Verify target document content in PostgreSQL now matches V1
    const verifiedDoc = new Y.Doc();
    await loadDocumentState(page1.id, verifiedDoc);
    const restoredJson = yTiptap.yXmlFragmentToProsemirrorJSON(verifiedDoc.getXmlFragment('default'));
    assert.strictEqual(restoredJson.content[0].content[0].text, 'Historical Snapshot Content V1');
  } catch (err) {
    report('8. EDITOR role successfully restores document (200 OK)', false, err.message);
  }

  // Test 9: OWNER role allowed to restore (200 OK)
  try {
    const res = await fetch(
      `${BASE_URL}/api/workspaces/${workspaceA.id}/pages/${page1.id}/versions/${snapshot1.id}/restore`,
      {
        method: 'POST',
        headers: { Cookie: cookieOwner },
      }
    );
    const body = await res.json();
    const isOk = res.status === 200 && body.success === true && body.restoredVersion?.id === snapshot1.id;
    report('9. OWNER role successfully restores document (200 OK)', isOk);
  } catch (err) {
    report('9. OWNER role successfully restores document (200 OK)', false, err.message);
  }

  // Cleanup test fixtures
  try {
    await prisma.versionSnapshot.deleteMany({
      where: { pageId: { in: [page1.id, page2.id, pageB.id] } },
    });
    await prisma.documentState.deleteMany({
      where: { pageId: { in: [page1.id, page2.id, pageB.id] } },
    });
    await prisma.page.deleteMany({
      where: { id: { in: [page1.id, page2.id, pageB.id] } },
    });
    await prisma.workspaceMember.deleteMany({
      where: { workspaceId: { in: [workspaceA.id, workspaceB.id] } },
    });
    await prisma.workspace.deleteMany({
      where: { id: { in: [workspaceA.id, workspaceB.id] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [owner.id, editor.id, commenter.id, viewer.id, stranger.id] } },
    });
  } catch (err) {
    console.warn('Cleanup warning:', err.message);
  }

  if (testServerProcess) {
    console.log('Shutting down Next.js test server...');
    testServerProcess.kill();
  }

  await closePersistence();

  console.log('\n======================================================================');
  console.log(`Restore API Verification Tests: ${passed} passed, ${failed} failed`);
  console.log('======================================================================\n');

  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  if (testServerProcess) testServerProcess.kill();
  process.exit(1);
});

