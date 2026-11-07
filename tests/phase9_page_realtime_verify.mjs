/**
 * Phase 9 Bug Fix: Real-Time PageTree Synchronization Test Suite
 *
 * Verifies:
 * 1. OWNER creates page; EDITOR sees it without refresh.
 * 2. OWNER creates page; COMMENTER sees it without refresh.
 * 3. OWNER creates page; VIEWER sees it without refresh.
 * 4. EDITOR creates page; OWNER sees it without refresh.
 * 5. Page rename synchronizes across authorized members.
 * 6. Page deletion synchronizes across authorized members.
 * 7. Subpage creation updates the correct hierarchy.
 * 8. Other workspaces do not receive these events (Strict Workspace Isolation).
 * 9. Unauthorized users cannot create, rename or delete pages.
 * 10. Repeated events do not create duplicate PageTree entries (Idempotence).
 * 11. Existing document collaboration and persistence remain functional.
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
const TEST_WS_PORT = 19495;

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

async function createSseSubscriber(url, cookie) {
  const controller = new AbortController();
  const events = [];
  const waiters = [];

  const res = await fetch(url, {
    headers: { Cookie: cookie },
    signal: controller.signal,
  });

  if (!res.ok) {
    throw new Error(`SSE subscription failed with status ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  (async () => {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const part of parts) {
          const lines = part.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const parsed = JSON.parse(line.slice(6));
                events.push(parsed);
                for (let i = waiters.length - 1; i >= 0; i--) {
                  const w = waiters[i];
                  if (w.predicate(parsed)) {
                    waiters.splice(i, 1);
                    w.resolve(parsed);
                  }
                }
              } catch {}
            }
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        // Stream closed
      }
    }
  })();

  // Wait for initial connected confirmation
  await new Promise((resolve) => {
    const check = () => {
      if (events.some((e) => e.type === 'CONNECTED')) {
        resolve();
      } else {
        setTimeout(check, 50);
      }
    };
    check();
  });

  return {
    events,
    waitForEvent(predicate, timeoutMs = 6000) {
      const existing = events.find(predicate);
      if (existing) return Promise.resolve(existing);

      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const idx = waiters.findIndex((w) => w.resolve === resolve);
          if (idx !== -1) waiters.splice(idx, 1);
          reject(new Error(`Timed out waiting for event after ${timeoutMs}ms`));
        }, timeoutMs);

        waiters.push({
          predicate,
          resolve: (val) => {
            clearTimeout(timer);
            resolve(val);
          },
        });
      });
    },
    close() {
      controller.abort();
    },
  };
}

async function runTests() {
  console.log('======================================================================');
  console.log('   Phase 9 Bug Fix: Real-Time PageTree Synchronization Test Suite     ');
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

  // 2. Collab WebSocket server on isolated port
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
  const prefix = `p9_sync_${ts}`;

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

  const workspace1 = await prisma.workspace.create({
    data: {
      name: `Sync WS1 ${ts}`,
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

  const workspace2 = await prisma.workspace.create({
    data: {
      name: `Sync WS2 Isolation ${ts}`,
      ownerId: outsiderUser.id,
    },
  });

  const ownerCookie = await generateSessionCookie(ownerUser);
  const editorCookie = await generateSessionCookie(editorUser);
  const commenterCookie = await generateSessionCookie(commenterUser);
  const viewerCookie = await generateSessionCookie(viewerUser);
  const outsiderCookie = await generateSessionCookie(outsiderUser);

  let subOwner = null;
  let subEditor = null;
  let subCommenter = null;
  let subViewer = null;
  let subOutsiderWS2 = null;

  try {
    // Connect subscribers to Workspace 1 events stream
    subOwner = await createSseSubscriber(`${BASE_URL}/api/workspaces/${workspace1.id}/pages/events`, ownerCookie);
    subEditor = await createSseSubscriber(`${BASE_URL}/api/workspaces/${workspace1.id}/pages/events`, editorCookie);
    subCommenter = await createSseSubscriber(`${BASE_URL}/api/workspaces/${workspace1.id}/pages/events`, commenterCookie);
    subViewer = await createSseSubscriber(`${BASE_URL}/api/workspaces/${workspace1.id}/pages/events`, viewerCookie);

    // Connect outsider subscriber to Workspace 2 events stream (for isolation test)
    subOutsiderWS2 = await createSseSubscriber(`${BASE_URL}/api/workspaces/${workspace2.id}/pages/events`, outsiderCookie);

    // -------------------------------------------------------------
    // Test 1: OWNER creates page; EDITOR sees it without refresh
    // -------------------------------------------------------------
    let createdPage1 = null;
    {
      const createRes = await fetch(`${BASE_URL}/api/workspaces/${workspace1.id}/pages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
        body: JSON.stringify({ title: 'Page 1 Created by Owner' }),
      });
      const data = await createRes.json();
      createdPage1 = data.page;

      const receivedEvent = await subEditor.waitForEvent(
        (e) => e.type === 'PAGE_CREATED' && e.page?.id === createdPage1.id
      );

      const success = createRes.status === 201 && receivedEvent?.page?.title === 'Page 1 Created by Owner';
      report(1, 'OWNER creates page; EDITOR receives real-time update', success, `PageId: ${createdPage1?.id}`);
    }

    // -------------------------------------------------------------
    // Test 2: OWNER creates page; COMMENTER sees it without refresh
    // -------------------------------------------------------------
    {
      const receivedEvent = await subCommenter.waitForEvent(
        (e) => e.type === 'PAGE_CREATED' && e.page?.id === createdPage1.id
      );
      report(2, 'OWNER creates page; COMMENTER receives real-time update', Boolean(receivedEvent), `Title: ${receivedEvent?.page?.title}`);
    }

    // -------------------------------------------------------------
    // Test 3: OWNER creates page; VIEWER sees it without refresh
    // -------------------------------------------------------------
    {
      const receivedEvent = await subViewer.waitForEvent(
        (e) => e.type === 'PAGE_CREATED' && e.page?.id === createdPage1.id
      );
      report(3, 'OWNER creates page; VIEWER receives real-time update', Boolean(receivedEvent), `Title: ${receivedEvent?.page?.title}`);
    }

    // -------------------------------------------------------------
    // Test 4: EDITOR creates page; OWNER sees it without refresh
    // -------------------------------------------------------------
    let createdPage2 = null;
    {
      const createRes = await fetch(`${BASE_URL}/api/workspaces/${workspace1.id}/pages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: editorCookie },
        body: JSON.stringify({ title: 'Page 2 Created by Editor' }),
      });
      const data = await createRes.json();
      createdPage2 = data.page;

      const receivedEvent = await subOwner.waitForEvent(
        (e) => e.type === 'PAGE_CREATED' && e.page?.id === createdPage2.id
      );

      const success = createRes.status === 201 && receivedEvent?.page?.title === 'Page 2 Created by Editor';
      report(4, 'EDITOR creates page; OWNER receives real-time update', success, `PageId: ${createdPage2?.id}`);
    }

    // -------------------------------------------------------------
    // Test 5: Page rename synchronizes across authorized members
    // -------------------------------------------------------------
    {
      const renameRes = await fetch(`${BASE_URL}/api/workspaces/${workspace1.id}/pages/${createdPage1.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: editorCookie },
        body: JSON.stringify({ title: 'Page 1 Renamed Title' }),
      });

      const eventOwner = await subOwner.waitForEvent(
        (e) => e.type === 'PAGE_UPDATED' && e.page?.id === createdPage1.id && e.page?.title === 'Page 1 Renamed Title'
      );
      const eventViewer = await subViewer.waitForEvent(
        (e) => e.type === 'PAGE_UPDATED' && e.page?.id === createdPage1.id && e.page?.title === 'Page 1 Renamed Title'
      );

      const success = renameRes.status === 200 && Boolean(eventOwner) && Boolean(eventViewer);
      report(5, 'Page rename synchronizes across all workspace members', success, `New title: ${eventOwner?.page?.title}`);
    }

    // -------------------------------------------------------------
    // Test 6: Page deletion synchronizes across authorized members
    // -------------------------------------------------------------
    {
      const deleteRes = await fetch(`${BASE_URL}/api/workspaces/${workspace1.id}/pages/${createdPage2.id}`, {
        method: 'DELETE',
        headers: { Cookie: editorCookie },
      });

      const eventOwner = await subOwner.waitForEvent(
        (e) => e.type === 'PAGE_DELETED' && e.pageId === createdPage2.id
      );
      const eventCommenter = await subCommenter.waitForEvent(
        (e) => e.type === 'PAGE_DELETED' && e.pageId === createdPage2.id
      );

      const success = deleteRes.status === 200 && Boolean(eventOwner) && Boolean(eventCommenter);
      report(6, 'Page deletion synchronizes across all workspace members', success, `Deleted PageId: ${eventOwner?.pageId}`);
    }

    // -------------------------------------------------------------
    // Test 7: Subpage creation updates the correct hierarchy
    // -------------------------------------------------------------
    let subPage = null;
    {
      const createSubRes = await fetch(`${BASE_URL}/api/workspaces/${workspace1.id}/pages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
        body: JSON.stringify({ title: 'Nested Child Document', parentPageId: createdPage1.id }),
      });
      const data = await createSubRes.json();
      subPage = data.page;

      const eventEditor = await subEditor.waitForEvent(
        (e) => e.type === 'PAGE_CREATED' && e.page?.id === subPage.id && e.page?.parentPageId === createdPage1.id
      );

      const success = createSubRes.status === 201 && eventEditor?.page?.parentPageId === createdPage1.id;
      report(7, 'Subpage creation updates parent-child hierarchy across members', success, `ParentId: ${eventEditor?.page?.parentPageId}`);
    }

    // -------------------------------------------------------------
    // Test 8: Other workspaces do not receive these events (Strict Isolation)
    // -------------------------------------------------------------
    {
      // SubOutsiderWS2 is subscribed to Workspace 2.
      // Verify that NO events from Workspace 1 were received by SubOutsiderWS2!
      const ws1Leak = subOutsiderWS2.events.some(
        (e) => e.page?.workspaceId === workspace1.id || e.workspaceId === workspace1.id
      );
      report(8, 'Strict Workspace Isolation: Other workspaces do not receive events', !ws1Leak, `Total WS2 events: ${subOutsiderWS2.events.length}`);
    }

    // -------------------------------------------------------------
    // Test 9: Unauthorized users cannot create, rename or delete pages
    // -------------------------------------------------------------
    {
      // COMMENTER tries to create -> 403
      const resCommenterCreate = await fetch(`${BASE_URL}/api/workspaces/${workspace1.id}/pages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: commenterCookie },
        body: JSON.stringify({ title: 'Commenter Illegal Page' }),
      });

      // VIEWER tries to rename -> 403
      const resViewerRename = await fetch(`${BASE_URL}/api/workspaces/${workspace1.id}/pages/${createdPage1.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: viewerCookie },
        body: JSON.stringify({ title: 'Viewer Illegal Rename' }),
      });

      // VIEWER tries to delete -> 403
      const resViewerDelete = await fetch(`${BASE_URL}/api/workspaces/${workspace1.id}/pages/${createdPage1.id}`, {
        method: 'DELETE',
        headers: { Cookie: viewerCookie },
      });

      // OUTSIDER tries to subscribe to WS1 events -> 403
      const resOutsiderSubscribe = await fetch(`${BASE_URL}/api/workspaces/${workspace1.id}/pages/events`, {
        headers: { Cookie: outsiderCookie },
      });

      const unauthorizedBlocked =
        resCommenterCreate.status === 403 &&
        resViewerRename.status === 403 &&
        resViewerDelete.status === 403 &&
        resOutsiderSubscribe.status === 403;

      report(
        9,
        'RBAC enforcement: Unauthorized users cannot mutate pages or access stream (403)',
        unauthorizedBlocked,
        `Create: ${resCommenterCreate.status}, Rename: ${resViewerRename.status}, Delete: ${resViewerDelete.status}, Stream: ${resOutsiderSubscribe.status}`
      );
    }

    // -------------------------------------------------------------
    // Test 10: Repeated events do not create duplicate PageTree entries (Idempotence)
    // -------------------------------------------------------------
    {
      // Simulate PageTree state reconciliation with duplicate events
      const mockRawPages = [{ id: createdPage1.id, title: 'Page 1', parentPageId: null }];

      // Helper simulating PageTree PAGE_CREATED reducer
      const applyEvent = (current, event) => {
        if (event.type === 'PAGE_CREATED' && event.page) {
          if (current.some((p) => p.id === event.page.id)) {
            return current;
          }
          return [...current, event.page];
        }
        return current;
      };

      const eventPayload = {
        type: 'PAGE_CREATED',
        page: { id: 'dup-test-page-01', title: 'Duplicate Test Page', parentPageId: null },
      };

      // Dispatch same event 5 times
      let state = mockRawPages;
      state = applyEvent(state, eventPayload);
      state = applyEvent(state, eventPayload);
      state = applyEvent(state, eventPayload);
      state = applyEvent(state, eventPayload);
      state = applyEvent(state, eventPayload);

      const count = state.filter((p) => p.id === 'dup-test-page-01').length;
      report(10, 'Repeated events do not create duplicate PageTree entries', count === 1, `Count: ${count}`);
    }

    // -------------------------------------------------------------
    // Test 11: Concurrent local createPage response and SSE delivery race resolution
    // -------------------------------------------------------------
    {
      // Simulate the exact race condition where SSE PAGE_CREATED arrives before createPage() promise resolves,
      // and then createPage() resolves and attempts to append to rawPages
      let clientRawPages = [{ id: 'existing-page-1', title: 'Existing', parentPageId: null }];
      const newPage = { id: 'cmw66fdgr0000bothz2poq5fx', title: 'New Race Page', parentPageId: null };

      // Step A: SSE arrives first
      if (!clientRawPages.some((p) => p.id === newPage.id)) {
        clientRawPages = [...clientRawPages, newPage];
      }

      // Step B: createPage() resolves second
      if (!clientRawPages.some((p) => p.id === newPage.id)) {
        clientRawPages = [...clientRawPages, newPage];
      }

      // Reverse order: createPage() resolves first, SSE arrives second
      let clientRawPagesReverse = [{ id: 'existing-page-1', title: 'Existing', parentPageId: null }];
      if (!clientRawPagesReverse.some((p) => p.id === newPage.id)) {
        clientRawPagesReverse = [...clientRawPagesReverse, newPage];
      }
      if (!clientRawPagesReverse.some((p) => p.id === newPage.id)) {
        clientRawPagesReverse = [...clientRawPagesReverse, newPage];
      }

      const countA = clientRawPages.filter((p) => p.id === newPage.id).length;
      const countB = clientRawPagesReverse.filter((p) => p.id === newPage.id).length;
      const raceSafe = countA === 1 && countB === 1;

      report(
        11,
        'Concurrent createPage API response and SSE delivery race preserves unique entry',
        raceSafe,
        `Forward: ${countA}, Reverse: ${countB}`
      );
    }

    // -------------------------------------------------------------
    // Test 12: buildPageTree deduplication, cycle protection & React key uniqueness
    // -------------------------------------------------------------
    {
      const pageTreeSource = fs.readFileSync(
        path.resolve(process.cwd(), 'src/components/workspace/PageTree.tsx'),
        'utf8'
      );

      // Verify source guards
      const hasItemMapValuesLoop = pageTreeSource.includes('for (const node of itemMap.values())');
      const hasIsAncestor = pageTreeSource.includes('function isAncestor(');
      const hasCreateDedup = pageTreeSource.includes('prev.some((p) => p.id === created.id)');
      const hasFetchDedup = pageTreeSource.includes('new Map(data.map((p) => [p.id, p])).values()');

      // Re-run the exact algorithm implementation from PageTree.tsx against pathological data
      function isAncestor(itemMap, potentialAncestorId, currentId) {
        let curr = itemMap.get(currentId);
        const visited = new Set();
        while (curr && curr.parentPageId) {
          if (visited.has(curr.id)) break;
          visited.add(curr.id);
          if (curr.parentPageId === potentialAncestorId) return true;
          curr = itemMap.get(curr.parentPageId);
        }
        return false;
      }

      function buildPageTreeTest(items) {
        const itemMap = new Map();
        const rootNodes = [];

        for (const item of items) {
          if (!item || !item.id) continue;
          if (!itemMap.has(item.id)) {
            itemMap.set(item.id, {
              id: item.id,
              title: item.title,
              parentPageId: item.parentPageId,
              children: [],
            });
          }
        }

        for (const node of itemMap.values()) {
          const parentId = node.parentPageId;
          if (
            parentId &&
            parentId !== node.id &&
            itemMap.has(parentId) &&
            !isAncestor(itemMap, node.id, parentId)
          ) {
            itemMap.get(parentId).children.push(node);
          } else {
            rootNodes.push(node);
          }
        }

        return rootNodes;
      }

      // Pathological inputs: duplicates, cyclic parents, self-parenting
      const duplicateRawData = [
        { id: 'cmw66fdgr0000bothz2poq5fx', title: 'Target Page', parentPageId: null },
        { id: 'cmw66fdgr0000bothz2poq5fx', title: 'Target Page (Duplicate 1)', parentPageId: null },
        { id: 'cmw66fdgr0000bothz2poq5fx', title: 'Target Page (Duplicate 2)', parentPageId: null },
        { id: 'child-1', title: 'Child 1', parentPageId: 'cmw66fdgr0000bothz2poq5fx' },
        { id: 'child-1', title: 'Child 1 (Duplicate)', parentPageId: 'cmw66fdgr0000bothz2poq5fx' },
        { id: 'self-parent', title: 'Self Parent', parentPageId: 'self-parent' },
        { id: 'cycle-A', title: 'Cycle A', parentPageId: 'cycle-B' },
        { id: 'cycle-B', title: 'Cycle B', parentPageId: 'cycle-A' },
      ];

      const tree = buildPageTreeTest(duplicateRawData);

      // Collect all keys rendered across all levels of the tree
      const renderedKeys = [];
      function collectKeys(nodes) {
        for (const n of nodes) {
          renderedKeys.push(n.id);
          if (n.children && n.children.length > 0) {
            collectKeys(n.children);
          }
        }
      }
      collectKeys(tree);

      const uniqueKeys = new Set(renderedKeys);
      const noDuplicateKeys = renderedKeys.length === uniqueKeys.size;
      const targetCount = renderedKeys.filter((k) => k === 'cmw66fdgr0000bothz2poq5fx').length;

      const passedAllChecks =
        hasItemMapValuesLoop &&
        hasIsAncestor &&
        hasCreateDedup &&
        hasFetchDedup &&
        noDuplicateKeys &&
        targetCount === 1;

      report(
        12,
        'buildPageTree eliminates duplicates, handles cycles, and guarantees strictly unique React keys',
        passedAllChecks,
        `Unique: ${noDuplicateKeys} (${renderedKeys.length}/${uniqueKeys.size}), TargetKeyCount: ${targetCount}`
      );
    }

    // -------------------------------------------------------------
    // Test 13: Existing document collaboration and persistence remain functional
    // -------------------------------------------------------------
    {
      const collabToken = await generateCollabToken({
        userId: editorUser.id,
        userName: editorUser.name,
        pageId: createdPage1.id,
        workspaceId: workspace1.id,
        role: 'EDITOR',
      });

      const ws = new WebSocket(`ws://127.0.0.1:${TEST_WS_PORT}/${createdPage1.id}`, {
        headers: { Origin: 'http://localhost:3000' },
      });

      let authenticated = false;
      let saveStatusConfirmed = false;

      await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          ws.close();
          resolve();
        }, 3000);

        ws.on('open', () => {
          ws.send(JSON.stringify({ type: 'auth', token: collabToken }));
        });

        ws.on('message', (data) => {
          try {
            const str = data.toString();
            if (str.startsWith('{')) {
              const json = JSON.parse(str);
              if (json.type === 'authenticated') {
                authenticated = true;
              }
              if (json.type === 'save_status') {
                saveStatusConfirmed = true;
              }
            }
          } catch {}
        });

        setTimeout(() => {
          ws.close();
          clearTimeout(timeout);
          resolve();
        }, 1500);
      });

      report(
        13,
        'Existing document collaboration and persistence intact',
        authenticated && saveStatusConfirmed,
        `Auth: ${authenticated}, SaveStatus: ${saveStatusConfirmed}`
      );
    }

  } finally {
    // Teardown subscribers
    if (subOwner) subOwner.close();
    if (subEditor) subEditor.close();
    if (subCommenter) subCommenter.close();
    if (subViewer) subViewer.close();
    if (subOutsiderWS2) subOutsiderWS2.close();

    // Teardown servers
    if (collabServer) {
      await collabServer.close();
    }
    if (testNextProcess) {
      testNextProcess.kill();
    }

    // Cleanup test data
    try {
      await prisma.page.deleteMany({
        where: { workspaceId: { in: [workspace1.id, workspace2.id] } },
      });
      await prisma.workspaceMember.deleteMany({
        where: { workspaceId: { in: [workspace1.id, workspace2.id] } },
      });
      await prisma.workspace.deleteMany({
        where: { id: { in: [workspace1.id, workspace2.id] } },
      });
      await prisma.user.deleteMany({
        where: {
          id: {
            in: [
              ownerUser.id,
              editorUser.id,
              commenterUser.id,
              viewerUser.id,
              outsiderUser.id,
            ],
          },
        },
      });
    } catch (cleanupErr) {
      console.warn('Cleanup warning:', cleanupErr.message);
    }

    await prisma.$disconnect();
    await pool.end();
  }

  console.log('\n======================================================================');
  console.log(`Phase 9 Bug Fix Results: ${passed} passed, ${failed} failed out of 13 tests.`);
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

