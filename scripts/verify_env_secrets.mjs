/**
 * Step 2 Verification Test Suite: Environment & Secrets Management
 * Real-Time Collaborative Workspace - Phase 12 Step 2
 *
 * Tests:
 * 1. Missing/weak/placeholder AUTH_SECRET produces safe errors without leaking secrets.
 * 2. Missing/malformed/low-entropy INTERNAL_RPC_SECRET produces safe errors.
 * 3. Missing/invalid DATABASE_URL in production fails safely without printing credentials.
 * 4. Redis URL credential redaction masks passwords in logs.
 * 5. REDIS_ENABLED=false passes validation for single-instance mode.
 * 6. Public/private URL validation and NEXT_PUBLIC_COLLAB_WS_URL consistency.
 * 7. .env.example contains placeholders only (rejected by strict validation).
 * 8. CollabServer startup fails fast on missing AUTH_SECRET or INTERNAL_RPC_SECRET.
 * 9. Valid cryptographic secrets pass strict validation and boot CollabServer cleanly.
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const rootDir = process.cwd();
const envModule = await import(
  pathToFileURL(path.resolve(rootDir, 'src/lib/env.mjs')).href
);
const collabProvider = await import(
  pathToFileURL(path.resolve(rootDir, 'src/lib/collab/collab-provider.mjs')).href
);
const collabClient = await import(
  pathToFileURL(path.resolve(rootDir, 'src/server/collab-internal-client.mjs')).href
);
const collabServerModule = await import(
  pathToFileURL(path.resolve(rootDir, 'src/server/collab-server.mjs')).href
);
const collabRedisModule = await import(
  pathToFileURL(path.resolve(rootDir, 'src/server/collab-redis.mjs')).href
);

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`PASS: ${name}`);
    })
    .catch((err) => {
      console.error(`FAIL: ${name}`);
      throw err;
    });
}

async function run() {
  let passed = 0;

  // 1. AUTH_SECRET validation
  await test('Rejects missing, short, low-entropy, and placeholder AUTH_SECRET safely', () => {
    const emptyRes = envModule.validateAuthSecret('');
    assert.equal(emptyRes.valid, false);

    const shortSecret = 'too-short-secret-value';
    const shortRes = envModule.validateAuthSecret(shortSecret);
    assert.equal(shortRes.valid, false);
    assert.ok(!shortRes.error.includes(shortSecret), 'Error must not expose secret');

    const lowEntropy = 'a'.repeat(40);
    const entropyRes = envModule.validateAuthSecret(lowEntropy);
    assert.equal(entropyRes.valid, false);
    assert.ok(!entropyRes.error.includes(lowEntropy), 'Error must not expose secret');

    const placeholder = 'change-this-to-a-secure-random-32-byte-secret';
    const placeholderRes = envModule.validateAuthSecret(placeholder);
    assert.equal(placeholderRes.valid, false);
    assert.ok(!placeholderRes.error.includes(placeholder), 'Error must not expose secret');

    const legacyDev = 'collab-workspace-super-secret-jwt-signing-key-32-chars-min!';
    const devWarnRes = envModule.validateAuthSecret(legacyDev, { isProduction: false });
    assert.equal(devWarnRes.valid, true);
    assert.ok(devWarnRes.warning);

    const prodErrRes = envModule.validateAuthSecret(legacyDev, { isProduction: true });
    assert.equal(prodErrRes.valid, false);
    assert.ok(!prodErrRes.error.includes(legacyDev), 'Error must not expose secret');

    assert.throws(
      () => envModule.getAuthSecretKey({ env: { NODE_ENV: 'production' } }),
      /AUTH_SECRET is missing/
    );
  });
  passed++;

  // 2. INTERNAL_RPC_SECRET validation
  await test('Rejects missing, non-hex, short, and low-entropy INTERNAL_RPC_SECRET safely', () => {
    assert.throws(() => collabClient.validateClientRpcSecret(''), /INTERNAL_RPC_SECRET is required/);

    const badSecret = 'not-a-valid-64-hex-secret-at-all';
    assert.throws(
      () => collabClient.validateClientRpcSecret(badSecret),
      (err) => err instanceof Error && !err.message.includes(badSecret)
    );

    const lowEntropyHex = '0'.repeat(64);
    assert.throws(
      () => collabServerModule.validateInternalRpcSecret(lowEntropyHex),
      /insufficient entropy/
    );

    const validHex = crypto.randomBytes(32).toString('hex');
    assert.equal(collabClient.validateClientRpcSecret(validHex), true);
    assert.equal(collabServerModule.validateInternalRpcSecret(validHex), true);
  });
  passed++;

  // 3. DATABASE_URL validation & credential protection
  await test('Enforces DATABASE_URL in production and never leaks credentials', () => {
    assert.throws(
      () => envModule.getDatabaseUrl({ env: { NODE_ENV: 'production' } }),
      /DATABASE_URL is required in production/
    );

    const badUrl = 'mysql://secretuser:SuperSecretPass99@db.example.com:3306/app';
    const res = envModule.validateDatabaseUrl(badUrl, { isProduction: true });
    assert.equal(res.valid, false);
    assert.ok(!res.error.includes('SuperSecretPass99'), 'DB password leaked in error');
    assert.ok(!res.error.includes('secretuser'), 'DB username leaked in error');

    const placeholderDb = 'postgresql://username:password@localhost:5432/collab_workspace';
    const phRes = envModule.validateDatabaseUrl(placeholderDb, { isProduction: true });
    assert.equal(phRes.valid, false);
  });
  passed++;

  // 4. Redis credential redaction & REDIS_ENABLED=false
  await test('Redacts Redis credentials in logs and allows REDIS_ENABLED=false', () => {
    const rawRedis = 'rediss://default:MyTopSecretRedisToken123@redis.example.com:6379';
    const redacted = envModule.redactUrlCredentials(rawRedis);
    assert.ok(!redacted.includes('MyTopSecretRedisToken123'), 'Redis password must be redacted');
    assert.ok(redacted.includes('***'), 'Redacted URL should mask credentials');
    assert.ok(redacted.includes('redis.example.com:6379'));

    const disabledCfg = envModule.validateRedisConfig({
      enabledEnv: 'false',
      urlEnv: undefined,
      isProduction: true,
    });
    assert.equal(disabledCfg.valid, true);
    assert.equal(disabledCfg.enabled, false);

    const disabledClient = collabRedisModule.createCollabRedis({ enabled: false });
    assert.equal(disabledClient.enabled, false);
    assert.equal(disabledClient.status, 'disabled');
  });
  passed++;

  // 5. WebSocket client URL consistency
  await test('Reads NEXT_PUBLIC_COLLAB_WS_URL consistently without NEXT_PUBLIC_COLLAB_URL mismatch', () => {
    const prev = process.env.NEXT_PUBLIC_COLLAB_WS_URL;
    try {
      process.env.NEXT_PUBLIC_COLLAB_WS_URL = 'wss://collab.example.com';
      assert.equal(collabProvider.getDefaultCollabWsUrl(), 'wss://collab.example.com');

      delete process.env.NEXT_PUBLIC_COLLAB_WS_URL;
      assert.equal(collabProvider.getDefaultCollabWsUrl(), 'ws://localhost:1234');
    } finally {
      if (prev === undefined) {
        delete process.env.NEXT_PUBLIC_COLLAB_WS_URL;
      } else {
        process.env.NEXT_PUBLIC_COLLAB_WS_URL = prev;
      }
    }
  });
  passed++;

  // 6. .env.example contains placeholders only
  await test('.env.example contains placeholders only and documents INTERNAL_RPC_SECRET & NEXT_PUBLIC_COLLAB_WS_URL', () => {
    const exampleContent = fs.readFileSync(path.resolve(rootDir, '.env.example'), 'utf8');
    const parsed = {};
    for (const rawLine of exampleContent.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const idx = line.indexOf('=');
      if (idx > 0) {
        const k = line.slice(0, idx).trim();
        const v = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
        parsed[k] = v;
      }
    }

    assert.ok('INTERNAL_RPC_SECRET' in parsed, '.env.example must document INTERNAL_RPC_SECRET');
    assert.ok('NEXT_PUBLIC_COLLAB_WS_URL' in parsed, '.env.example must use NEXT_PUBLIC_COLLAB_WS_URL');
    assert.ok(!('NEXT_PUBLIC_COLLAB_URL' in parsed), 'Old mismatched NEXT_PUBLIC_COLLAB_URL must be removed');

    const strictCheck = envModule.validateRuntimeEnv({
      env: { ...parsed, NODE_ENV: 'production' },
      target: 'all',
      strict: true,
    });
    assert.equal(strictCheck.ok, false, '.env.example placeholders must fail strict production validation');
  });
  passed++;

  // 7. CollabServer fails fast on missing AUTH_SECRET and boots with strong secrets
  await test('CollabServer fails fast on missing AUTH_SECRET and starts cleanly with strong secrets', async () => {
    const strongRpc = crypto.randomBytes(32).toString('hex');
    const strongAuth = crypto.randomBytes(32).toString('base64url');

    assert.throws(
      () =>
        collabServerModule.createCollabServer({
          port: 0,
          authSecret: '',
          internalRpcSecret: strongRpc,
          enableRedis: false,
          loadDocumentState: async () => ({ version: 1, source: 'test' }),
        }),
      /AUTH_SECRET is missing/
    );

    const inst = collabServerModule.createCollabServer({
      port: 0,
      authSecret: strongAuth,
      internalRpcSecret: strongRpc,
      enableRedis: false,
      loadDocumentState: async () => ({ version: 1, source: 'test' }),
    });
    await inst.start();
    assert.ok(inst.server.listening, 'CollabServer should bind and listen');
    await inst.close();
  });
  passed++;

  // 8. Full strict runtime validation passes with valid cryptographic secrets
  await test('Full strict production environment validation passes with valid secrets', () => {
    const validEnv = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://appuser:StrongDbPass@db.neon.tech:5432/neondb?sslmode=require',
      AUTH_SECRET: crypto.randomBytes(32).toString('base64url'),
      INTERNAL_RPC_SECRET: crypto.randomBytes(32).toString('hex'),
      NEXT_PUBLIC_APP_URL: 'https://workspace.example.com',
      NEXT_PUBLIC_COLLAB_WS_URL: 'wss://workspace.example.com',
      COLLAB_PORT: '1234',
      REDIS_ENABLED: 'false',
    };

    const result = envModule.validateRuntimeEnv({
      env: validEnv,
      target: 'all',
      strict: true,
      throwOnError: true,
    });

    assert.equal(result.ok, true);
    assert.equal(result.errors.length, 0);
  });
  passed++;

  console.log(`\nALL ${passed} ENV & SECRETS VERIFICATION TESTS PASSED.`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

