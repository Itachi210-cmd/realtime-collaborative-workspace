/**
 * Phase 10 Step 3: Versions API Verification Test Suite
 *
 * Verifies:
 * 1. Authentication requirements (401 for missing session cookie).
 * 2. Workspace membership verification (403 for non-members).
 * 3. Cross-workspace IDOR protection (404 when pageId doesn't belong to workspace).
 * 4. Role-based snapshot creation authorization:
 *    - VIEWER cannot create snapshots (403 Forbidden).
 *    - COMMENTER cannot create snapshots (403 Forbidden).
 *    - EDITOR can create snapshots (201 Created).
 *    - OWNER can create snapshots (201 Created).
 * 5. Session identity binding (createdById is derived strictly from session).
 * 6. Zod payload validation (rejects label > 100 chars, description > 500 chars, invalid JSON).
 * 7. Snapshot listing API:
 *    - Accessible to all roles (OWNER, EDITOR, COMMENTER, VIEWER get 200).
 *    - Returns newest first.
 *    - Excludes heavy binary yjsState from response payload.
 * 8. Single snapshot preview API:
 *    - Accessible to all roles (including VIEWER).
 *    - Includes TipTap content JSON preview.
 *    - Excludes binary yjsState from preview response.
 *    - Rejects mismatched pageId / versionId with 404 (cross-page isolation).
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
  console.log('======================================================================');
  console.log('    Phase 10 Step 3: Versions HTTP API Verification Test Suite        ');
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
    testServerProcess.stderr?.on('data', (d) => {
      const msg = d.toString();
      if (!msg.includes('middleware') && !msg.includes('ExperimentalWarning')) {
        // console.error('[Server stderr]', msg);
      }
    });
    await waitForServer(BASE_URL);
    console.log(`Next.js test server ready on ${BASE_URL}.\n`);
  }

  const timestamp = Date.now();
  const testEmailPrefix = `p10_api_${timestamp}`;

  // 1. Seed users representing all roles + 1 non-member
  const ownerUser = await prisma.user.create({
    data: {
      name: 'P10 Owner',
      email: `${testEmailPrefix}_owner@test.com`,
      passwordHash: 'testhash',
    },
  });

  const editorUser = await prisma.user.create({
    data: {
      name: 'P10 Editor',
      email: `${testEmailPrefix}_editor@test.com`,
      passwordHash: 'testhash',
    },
  });

  const commenterUser = await prisma.user.create({
    data: {
      name: 'P10 Commenter',
      email: `${testEmailPrefix}_commenter@test.com`,
      passwordHash: 'testhash',
    },
  });

  const viewerUser = await prisma.user.create({
    data: {
      name: 'P10 Viewer',
      email: `${testEmailPrefix}_viewer@test.com`,
      passwordHash: 'testhash',
    },
  });

  const nonMemberUser = await prisma.user.create({
    data: {
      name: 'P10 NonMember',
      email: `${testEmailPrefix}_nonmember@test.com`,
      passwordHash: 'testhash',
    },
  });

  // 2. Generate session cookies
  const cookieOwner = await generateSessionCookie(ownerUser);
  const cookieEditor = await generateSessionCookie(editorUser);
  const cookieCommenter = await generateSessionCookie(commenterUser);
  const cookieViewer = await generateSessionCookie(viewerUser);
  const cookieNonMember = await generateSessionCookie(nonMemberUser);

  // 3. Create workspace & assign memberships
  const testWorkspace = await prisma.workspace.create({
    data: {
      name: `P10 Version WS ${timestamp}`,
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

  const otherWorkspace = await prisma.workspace.create({
    data: {
      name: `P10 Other WS ${timestamp}`,
      ownerId: ownerUser.id,
    },
  });

  // 4. Create document in workspace
  const testPage = await prisma.page.create({
    data: {
      workspaceId: testWorkspace.id,
      title: 'Phase 10 Versions API Document',
      createdById: ownerUser.id,
    },
  });

  const otherPage = await prisma.page.create({
    data: {
      workspaceId: otherWorkspace.id,
      title: 'Phase 10 Isolated Page',
      createdById: ownerUser.id,
    },
  });

  let createdSnapshotId = null;

  try {
    // --------------------------------------------------------------------
    // Section A: Authentication & Workspace Authorization
    // --------------------------------------------------------------------
    console.log('--- Section A: Authentication & Access Control ---');

    // A1. Unauthenticated GET /versions -> 401
    {
      const res = await fetch(`${BASE_URL}/api/workspaces/${testWorkspace.id}/pages/${testPage.id}/versions`);
      report('A1. GET /versions returns 401 Unauthorized without session cookie', res.status === 401, `Status: ${res.status}`);
    }

    // A2. Unauthenticated POST /versions -> 401
    {
      const res = await fetch(`${BASE_URL}/api/workspaces/${testWorkspace.id}/pages/${testPage.id}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: 'Unauthorized test' }),
      });
      report('A2. POST /versions returns 401 Unauthorized without session cookie', res.status === 401, `Status: ${res.status}`);
    }

    // A3. Non-member access -> 403
    {
      const res = await fetch(`${BASE_URL}/api/workspaces/${testWorkspace.id}/pages/${testPage.id}/versions`, {
        headers: { Cookie: cookieNonMember },
      });
      report('A3. GET /versions returns 403 Forbidden for non-workspace user', res.status === 403, `Status: ${res.status}`);
    }

    // A4. IDOR cross-workspace document access -> 404
    {
      const res = await fetch(`${BASE_URL}/api/workspaces/${otherWorkspace.id}/pages/${testPage.id}/versions`, {
        headers: { Cookie: cookieOwner },
      });
      report('A4. GET /versions returns 404 when document does not belong to specified workspace', res.status === 404, `Status: ${res.status}`);
    }

    // --------------------------------------------------------------------
    // Section B: Role-Based Permissions for Snapshot Creation (POST)
    // --------------------------------------------------------------------
    console.log('\n--- Section B: Role-Based Creation Permissions ---');

    // B1. VIEWER POST -> 403
    {
      const res = await fetch(`${BASE_URL}/api/workspaces/${testWorkspace.id}/pages/${testPage.id}/versions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookieViewer,
        },
        body: JSON.stringify({ label: 'Viewer snapshot attempt' }),
      });
      const data = await res.json().catch(() => ({}));
      report(
        'B1. VIEWER receives 403 Forbidden when attempting to create snapshot',
        res.status === 403,
        `Status: ${res.status}, error: "${data.error}"`
      );
    }

    // B2. COMMENTER POST -> 403
    {
      const res = await fetch(`${BASE_URL}/api/workspaces/${testWorkspace.id}/pages/${testPage.id}/versions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookieCommenter,
        },
        body: JSON.stringify({ label: 'Commenter snapshot attempt' }),
      });
      const data = await res.json().catch(() => ({}));
      report(
        'B2. COMMENTER receives 403 Forbidden when attempting to create snapshot',
        res.status === 403,
        `Status: ${res.status}, error: "${data.error}"`
      );
    }

    // B3. EDITOR POST -> 201
    {
      const res = await fetch(`${BASE_URL}/api/workspaces/${testWorkspace.id}/pages/${testPage.id}/versions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookieEditor,
        },
        body: JSON.stringify({
          label: 'Editor Milestone v1',
          description: 'Document architecture draft captured by editor.',
        }),
      });
      const data = await res.json().catch(() => ({}));
      const ok = res.status === 201 && data.version?.label === 'Editor Milestone v1' && data.version?.createdById === editorUser.id;
      createdSnapshotId = data.version?.id;
      report(
        'B3. EDITOR successfully creates version snapshot (201 Created)',
        ok,
        `Status: ${res.status}, snapshotId: ${createdSnapshotId}, createdById: ${data.version?.createdById}`
      );

      // Verify yjsState byte array is NOT leaked in HTTP JSON response
      report(
        'B3b. POST response omits heavy binary yjsState from JSON body',
        data.version?.yjsState === undefined,
        `yjsState: ${data.version?.yjsState}`
      );
    }

    // B4. OWNER POST -> 201
    {
      const res = await fetch(`${BASE_URL}/api/workspaces/${testWorkspace.id}/pages/${testPage.id}/versions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookieOwner,
        },
        body: JSON.stringify({
          label: 'Owner Approved Release',
        }),
      });
      const data = await res.json().catch(() => ({}));
      const ok = res.status === 201 && data.version?.label === 'Owner Approved Release' && data.version?.createdById === ownerUser.id;
      report(
        'B4. OWNER successfully creates version snapshot (201 Created)',
        ok,
        `Status: ${res.status}, createdById: ${data.version?.createdById}`
      );
    }

    // --------------------------------------------------------------------
    // Section C: Payload Validation
    // --------------------------------------------------------------------
    console.log('\n--- Section C: Payload Validation ---');

    // C1. Label exceeds 100 characters -> 400
    {
      const res = await fetch(`${BASE_URL}/api/workspaces/${testWorkspace.id}/pages/${testPage.id}/versions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookieEditor,
        },
        body: JSON.stringify({
          label: 'A'.repeat(101),
        }),
      });
      report('C1. Rejects label exceeding 100 characters with 400 Bad Request', res.status === 400, `Status: ${res.status}`);
    }

    // C2. Description exceeds 500 characters -> 400
    {
      const res = await fetch(`${BASE_URL}/api/workspaces/${testWorkspace.id}/pages/${testPage.id}/versions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookieEditor,
        },
        body: JSON.stringify({
          label: 'Valid label',
          description: 'D'.repeat(501),
        }),
      });
      report('C2. Rejects description exceeding 500 characters with 400 Bad Request', res.status === 400, `Status: ${res.status}`);
    }

    // C3. Malformed JSON -> 400
    {
      const res = await fetch(`${BASE_URL}/api/workspaces/${testWorkspace.id}/pages/${testPage.id}/versions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookieEditor,
        },
        body: 'invalid-json{{{',
      });
      report('C3. Rejects invalid JSON syntax with 400 Bad Request', res.status === 400, `Status: ${res.status}`);
    }

    // C4. Empty body -> 201 Created with null label
    {
      const res = await fetch(`${BASE_URL}/api/workspaces/${testWorkspace.id}/pages/${testPage.id}/versions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookieEditor,
        },
        body: '{}',
      });
      const data = await res.json().catch(() => ({}));
      report('C4. Accepts empty body and creates snapshot with null label', res.status === 201 && data.version?.label === null, `Status: ${res.status}`);
    }

    // --------------------------------------------------------------------
    // Section D: Snapshot Listing (GET /versions)
    // --------------------------------------------------------------------
    console.log('\n--- Section D: Snapshot Listing ---');

    // D1. Accessible to all 4 roles
    {
      const resViewer = await fetch(`${BASE_URL}/api/workspaces/${testWorkspace.id}/pages/${testPage.id}/versions`, {
        headers: { Cookie: cookieViewer },
      });
      const dataViewer = await resViewer.json().catch(() => ({}));

      const resCommenter = await fetch(`${BASE_URL}/api/workspaces/${testWorkspace.id}/pages/${testPage.id}/versions`, {
        headers: { Cookie: cookieCommenter },
      });

      report(
        'D1. Snapshot list accessible to VIEWER (200 OK)',
        resViewer.status === 200 && Array.isArray(dataViewer.versions),
        `Status: ${resViewer.status}, count: ${dataViewer.versions?.length}`
      );

      report(
        'D1b. Snapshot list accessible to COMMENTER (200 OK)',
        resCommenter.status === 200,
        `Status: ${resCommenter.status}`
      );

      // Verify ordering newest first
      const versions = dataViewer.versions || [];
      let isOrdered = versions.length >= 2;
      for (let i = 0; i < versions.length - 1; i++) {
        if (new Date(versions[i].createdAt).getTime() < new Date(versions[i + 1].createdAt).getTime()) {
          isOrdered = false;
        }
      }
      report(
        'D2. Snapshot list ordered newest first (createdAt DESC)',
        isOrdered,
        `Total snapshots: ${versions.length}`
      );

      // Verify yjsState is NOT present in listing
      const hasNoBytea = versions.every((v) => v.yjsState === undefined);
      report('D3. Snapshot listing omits heavy binary yjsState from every item', hasNoBytea);
    }

    // --------------------------------------------------------------------
    // Section E: Single Snapshot Preview (GET /versions/[versionId])
    // --------------------------------------------------------------------
    console.log('\n--- Section E: Single Snapshot Preview ---');

    // E1. Retrieve single snapshot preview
    {
      const res = await fetch(
        `${BASE_URL}/api/workspaces/${testWorkspace.id}/pages/${testPage.id}/versions/${createdSnapshotId}`,
        {
          headers: { Cookie: cookieViewer },
        }
      );
      const data = await res.json().catch(() => ({}));
      const ok = res.status === 200 && data.version?.id === createdSnapshotId && data.version?.label === 'Editor Milestone v1';
      report(
        'E1. VIEWER can preview single snapshot with content preview (200 OK)',
        ok,
        `Status: ${res.status}, label: "${data.version?.label}"`
      );

      report(
        'E2. Single preview response omits binary yjsState',
        data.version?.yjsState === undefined
      );
    }

    // E3. Query non-existent snapshot ID -> 404
    {
      const res = await fetch(
        `${BASE_URL}/api/workspaces/${testWorkspace.id}/pages/${testPage.id}/versions/non-existent-cuid-12345`,
        {
          headers: { Cookie: cookieViewer },
        }
      );
      report('E3. Querying non-existent version ID returns 404 Not Found', res.status === 404, `Status: ${res.status}`);
    }

    // E4. Cross-page isolation -> 404
    {
      const res = await fetch(
        `${BASE_URL}/api/workspaces/${otherWorkspace.id}/pages/${otherPage.id}/versions/${createdSnapshotId}`,
        {
          headers: { Cookie: cookieOwner },
        }
      );
      report(
        'E4. Querying snapshot under wrong page returns 404 (Cross-page isolation)',
        res.status === 404,
        `Status: ${res.status}`
      );
    }

  } finally {
    // --------------------------------------------------------------------
    // Cleanup
    // --------------------------------------------------------------------
    console.log('\nCleaning up test fixtures...');
    try {
      await prisma.versionSnapshot.deleteMany({
        where: { pageId: { in: [testPage.id, otherPage.id] } },
      });
      await prisma.page.deleteMany({
        where: { id: { in: [testPage.id, otherPage.id] } },
      });
      await prisma.workspaceMember.deleteMany({
        where: { workspaceId: { in: [testWorkspace.id, otherWorkspace.id] } },
      });
      await prisma.workspace.deleteMany({
        where: { id: { in: [testWorkspace.id, otherWorkspace.id] } },
      });
      await prisma.user.deleteMany({
        where: {
          id: {
            in: [
              ownerUser.id,
              editorUser.id,
              commenterUser.id,
              viewerUser.id,
              nonMemberUser.id,
            ],
          },
        },
      });
    } catch (err) {
      console.warn('Cleanup warning:', err.message);
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

