import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execSync, spawn } from 'node:child_process';
import { SignJWT } from 'jose';
import { WebSocket } from 'ws';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import { createCollabServer } from '../src/server/collab-server.mjs';

const TEST_AUTH_SECRET = crypto.randomBytes(32).toString('base64url');
const TEST_RPC_SECRET = crypto.randomBytes(32).toString('hex');
const TEST_DB_URL = 'postgresql://postgres:testpw@127.0.0.1:59999/collab_workspace?schema=public';

async function createTestCollabJwt(pageId) {
  const key = new TextEncoder().encode(TEST_AUTH_SECRET);
  return await new SignJWT({
    userName: 'Step3 Verifier',
    userColor: '#2563eb',
    pageId,
    workspaceId: 'ws-test-1',
    role: 'EDITOR',
    purpose: 'collaboration',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('user-test-1')
    .setIssuer('collab-workspace-auth')
    .setAudience('collab-workspace-yjs')
    .setIssuedAt()
    .setExpirationTime('2m')
    .sign(key);
}

function sendAuthAndSyncStep1(ws, token, doc) {
  const authPayload = JSON.stringify({ type: 'auth', token });
  ws.send(authPayload);

  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, 0);
  syncProtocol.writeSyncStep1(enc, doc);
  ws.send(encoding.toUint8Array(enc));
}

async function testCollabHealthChecks() {
  // 1. Healthy mocked persistence + enableRedis=false => HTTP 200
  const healthyServer = createCollabServer({
    port: 0,
    host: '127.0.0.1',
    authSecret: TEST_AUTH_SECRET,
    internalRpcSecret: TEST_RPC_SECRET,
    enableRedis: false,
    loadDocumentState: async () => ({ yjsState: null, stateVersion: 0 }),
  });
  await healthyServer.start();
  const hAddr = healthyServer.server.address();
  const hPort = typeof hAddr === 'object' && hAddr ? hAddr.port : healthyServer.port;

  try {
    const res = await fetch(`http://127.0.0.1:${hPort}/healthz`);
    const body = await res.json();
    assert.equal(res.status, 200, 'Mocked collab server with Redis disabled should return 200');
    assert.equal(body.status, 'ok');
    assert.equal(body.redis.enabled, false);
    assert.equal(body.redis.healthy, true);
    assert.equal(body.database.healthy, true);
  } finally {
    await healthyServer.close();
  }
  console.log('PASS: CollabServer /healthz returns 200 when mocked DB ready and REDIS_ENABLED=false');

  // 2. Failing DB ($queryRaw rejects) => HTTP 503 degraded
  const failingDbServer = createCollabServer({
    port: 0,
    host: '127.0.0.1',
    authSecret: TEST_AUTH_SECRET,
    internalRpcSecret: TEST_RPC_SECRET,
    enableRedis: false,
    prisma: {
      $queryRaw: async () => {
        throw new Error('ECONNREFUSED');
      },
      page: { findUnique: async () => null },
      documentState: { findUnique: async () => null },
    },
  });
  await failingDbServer.start();
  const fAddr = failingDbServer.server.address();
  const fPort = typeof fAddr === 'object' && fAddr ? fAddr.port : failingDbServer.port;

  try {
    const res = await fetch(`http://127.0.0.1:${fPort}/healthz`);
    const body = await res.json();
    assert.equal(res.status, 503, 'CollabServer must return 503 when DB check fails');
    assert.equal(body.status, 'degraded');
    assert.equal(body.database.healthy, false);
  } finally {
    await failingDbServer.close();
  }
  console.log('PASS: CollabServer /healthz returns 503 when PostgreSQL is unavailable');

  // 3. Enabled Redis unreachable => HTTP 503 degraded (connects gracefully without crash)
  const failingRedisServer = createCollabServer({
    port: 0,
    host: '127.0.0.1',
    authSecret: TEST_AUTH_SECRET,
    internalRpcSecret: TEST_RPC_SECRET,
    enableRedis: true,
    redisUrl: 'redis://127.0.0.1:63999',
    redisOptions: { maxRetriesPerRequest: 1, retryStrategy: () => null },
    loadDocumentState: async () => ({ yjsState: null, stateVersion: 0 }),
  });
  await failingRedisServer.start();
  const rAddr = failingRedisServer.server.address();
  const rPort = typeof rAddr === 'object' && rAddr ? rAddr.port : failingRedisServer.port;

  try {
    const res = await fetch(`http://127.0.0.1:${rPort}/healthz`);
    const body = await res.json();
    assert.equal(res.status, 503, 'CollabServer must return 503 when enabled Redis is unreachable');
    assert.equal(body.status, 'degraded');
    assert.equal(body.redis.enabled, true);
    assert.equal(body.redis.healthy, false);
  } finally {
    await failingRedisServer.close();
  }
  console.log('PASS: CollabServer /healthz returns 503 when enabled Redis is unavailable');
}

async function testWsUpgradeAndShutdownFlush() {
  let closeCalled = false;
  const server = createCollabServer({
    port: 0,
    host: '127.0.0.1',
    authSecret: TEST_AUTH_SECRET,
    internalRpcSecret: TEST_RPC_SECRET,
    enableRedis: false,
    allowedOrigins: ['http://localhost:3000'],
    prisma: {
      $queryRaw: async () => [{ '?column?': 1 }],
      page: {
        findUnique: async () => ({ id: 'page-step3', title: 'Step3', content: null }),
      },
      documentState: {
        findUnique: async () => null,
        upsert: async () => ({ stateVersion: 1 }),
      },
      $disconnect: async () => {
        closeCalled = true;
      },
    },
    loadDocumentState: async () => ({ yjsState: null, stateVersion: 0 }),
  });
  await server.start();
  const addr = server.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : server.port;

  try {
    const token = await createTestCollabJwt('page-step3');
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/collab-ws/page-step3`, {
        headers: { Origin: 'http://localhost:3000' },
      });
      const doc = new Y.Doc();
      const timeout = setTimeout(() => reject(new Error('WS auth sync timed out')), 4000);

      ws.on('open', () => {
        sendAuthAndSyncStep1(ws, token, doc);
      });
      ws.on('message', (data) => {
        const bytes = new Uint8Array(data);
        if (bytes.length > 0 && bytes[0] === 0) {
          clearTimeout(timeout);
          ws.close();
          doc.destroy();
          resolve();
        }
      });
      ws.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
    console.log('PASS: CollabServer /collab-ws/:pageId upgrade path normalizes and completes Yjs JWT sync');
  } finally {
    await server.close();
  }
  assert.equal(closeCalled, false, 'Injected test prisma without closePersistence option leaves pool intact');
}

async function waitForHttpReady(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      return res;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function measureTreeProcessMemoryMb(rootPid) {
  try {
    if (process.platform === 'win32') {
      const psCmd = [
        '$all = Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine,WorkingSetSize;',
        `$root = ${rootPid};`,
        '$kids = $all | Where-Object { $_.ProcessId -eq $root -or $_.ParentProcessId -eq $root };',
        '$kids | Select-Object ProcessId,ParentProcessId,Name,WorkingSetSize | ConvertTo-Json -Compress',
      ].join(' ');
      const out = execSync(`powershell -NoProfile -Command "${psCmd}"`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (!out) return [];
      const parsed = JSON.parse(out);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      return list.map((p) => ({
        pid: p.ProcessId,
        name: p.Name,
        rssMB: Number((p.WorkingSetSize / (1024 * 1024)).toFixed(2)),
      }));
    }
  } catch {
    return [];
  }
  return [];
}

async function testProdEntrypointStandaloneRuntime() {
  const standaloneServer = path.resolve(process.cwd(), '.next', 'standalone', 'server.js');
  if (!fs.existsSync(standaloneServer)) {
    throw new Error('Standalone server.js missing. Run npm run build first.');
  }

  const child = spawn(process.execPath, ['scripts/prod-entrypoint.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: '3190',
      NEXT_INTERNAL_PORT: '3191',
      COLLAB_PORT: '3192',
      COLLAB_PUBLIC_PORT: '3193',
      HOSTNAME: '127.0.0.1',
      NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3190',
      NEXT_PUBLIC_COLLAB_WS_URL: 'ws://127.0.0.1:3190/collab-ws',
      COLLAB_ALLOWED_ORIGINS: 'http://127.0.0.1:3190,http://localhost:3000',
      DATABASE_URL: TEST_DB_URL,
      AUTH_SECRET: TEST_AUTH_SECRET,
      INTERNAL_RPC_SECRET: TEST_RPC_SECRET,
      REDIS_ENABLED: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  try {
    // Wait for HTTP ingress to come online
    const loginRes = await waitForHttpReady('http://127.0.0.1:3190/login', 20_000);
    assert.equal(loginRes.status, 200, 'Standalone /login route should return HTTP 200 via prod-entrypoint');

    // Verify /api/health returns 503 degraded when DB port 59999 is down, and reveals zero secrets
    const healthRes = await fetch('http://127.0.0.1:3190/api/health');
    const healthText = await healthRes.text();
    const healthJson = JSON.parse(healthText);
    assert.equal(healthRes.status, 503, '/api/health must return 503 when PostgreSQL is unavailable');
    assert.equal(healthJson.status, 'degraded');
    assert.equal(healthJson.checks.database.healthy, false);
    assert.equal(healthText.includes(TEST_AUTH_SECRET), false, 'Health JSON must not leak AUTH_SECRET');
    assert.equal(healthText.includes(TEST_RPC_SECRET), false, 'Health JSON must not leak INTERNAL_RPC_SECRET');
    assert.equal(healthText.includes('testpw'), false, 'Health JSON must not leak DB password');

    // Verify external access to /internal/* is blocked with 403 on BOTH HTTP ingress and dedicated WS port
    const rpcBlock1 = await fetch('http://127.0.0.1:3190/internal/rooms/test/flush', { method: 'POST' });
    assert.equal(rpcBlock1.status, 403, 'Public port must block /internal/* with HTTP 403');
    const rpcBlock2 = await fetch('http://127.0.0.1:3193/internal/rooms/test/flush', { method: 'POST' });
    assert.equal(rpcBlock2.status, 403, 'Dedicated WS port must block /internal/* with HTTP 403');

    // Verify WebSocket upgrade forwarding works across BOTH ports (public /collab-ws and dedicated WS port)
    for (const wsUrl of [
      'ws://127.0.0.1:3190/collab-ws/page-runtime-test',
      'ws://127.0.0.1:3193/page-runtime-test',
    ]) {
      await new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl, {
          headers: { Origin: 'http://127.0.0.1:3190' },
        });
        const timer = setTimeout(() => {
          ws.terminate();
          reject(new Error(`Timeout waiting for WebSocket open on ${wsUrl}`));
        }, 4000);
        ws.on('open', () => {
          clearTimeout(timer);
          ws.close();
          resolve();
        });
        ws.on('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
      });
    }

    const memStats = measureTreeProcessMemoryMb(child.pid);
    const totalRss = memStats.reduce((sum, p) => sum + p.rssMB, 0);
    console.log(
      `PASS: prod-entrypoint.mjs live smoke passed (measured process tree total RSS=${totalRss.toFixed(2)} MB across ${memStats.length} Node processes)`
    );
    if (memStats.length > 0) {
      console.log('Measured Process RSS Breakdown:', JSON.stringify(memStats));
    }
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => {
      const killTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {}
        resolve();
      }, 4000);
      child.once('exit', () => {
        clearTimeout(killTimer);
        resolve();
      });
    });
  }

  assert.equal(stdout.includes(TEST_AUTH_SECRET), false, 'Stdout must never leak AUTH_SECRET');
  assert.equal(stderr.includes(TEST_AUTH_SECRET), false, 'Stderr must never leak AUTH_SECRET');
}

async function main() {
  await testCollabHealthChecks();
  await testWsUpgradeAndShutdownFlush();
  await testProdEntrypointStandaloneRuntime();
  console.log('\nALL STEP 3 RUNTIME & DOCKER READINESS VERIFICATIONS PASSED.');
}

main().catch((err) => {
  console.error('VERIFICATION FAILED:', err);
  process.exit(1);
});
