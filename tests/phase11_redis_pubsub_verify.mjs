/**
 * Phase 11 Step 1: Redis Pub/Sub Unit & Integration Verification Suite
 *
 * Tests:
 * 1. Redis connection configuration and health checks.
 * 2. Dedicated publisher and subscriber connections.
 * 3. Page-specific channel routing and message delivery.
 * 4. Instance ID filtering to prevent self-echo and infinite loops.
 * 5. Binary Yjs update base64 encoding and decoding integrity.
 * 6. Subscription lifecycle (subscribe, multi-listener dispatch, unsubscribe).
 * 7. Graceful degradation when Redis is disabled or closed.
 */

import assert from 'node:assert';
import { createCollabRedis, DEFAULT_REDIS_URL } from '../src/server/collab-redis.mjs';

const REDIS_URL = process.env.REDIS_URL || DEFAULT_REDIS_URL;

async function runTests() {
  console.log('======================================================================');
  console.log('    Phase 11 Step 1: Redis Pub/Sub Unit & Integration Test Suite      ');
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

  // --- 1. Connection & Health Checks ---
  console.log('--- Section 1: Redis Connection & Health ---');
  const redisA = createCollabRedis({
    redisUrl: REDIS_URL,
    instanceId: 'test-inst-A',
  });
  const redisB = createCollabRedis({
    redisUrl: REDIS_URL,
    instanceId: 'test-inst-B',
  });

  try {
    await Promise.all([redisA.connect(), redisB.connect()]);
    report('TC-P11-U01: Both dedicated publisher and subscriber clients connect', redisA.isHealthy() && redisB.isHealthy());
    report('TC-P11-U02: Health status reports ready', redisA.status === 'ready' && redisB.status === 'ready');
  } catch (err) {
    report('TC-P11-U01: Connection failed', false, err.message);
  }

  // --- 2. Channel & Pub/Sub Delivery ---
  console.log('\n--- Section 2: Channel Routing & Message Delivery ---');
  const pageId1 = `p11_test_page_${Date.now()}_1`;
  const pageId2 = `p11_test_page_${Date.now()}_2`;

  const receivedOnB = [];
  const receivedOnA = [];

  redisB.subscribeRoom(pageId1, (updateBytes, meta) => {
    receivedOnB.push({ updateBytes, meta });
  });

  redisA.subscribeRoom(pageId1, (updateBytes, meta) => {
    receivedOnA.push({ updateBytes, meta });
  });

  // Allow Redis subscription commands to complete
  await new Promise((r) => setTimeout(r, 100));

  const sampleUpdate = new Uint8Array([0, 1, 2, 3, 4, 255, 128, 64]);
  const pubResult = await redisA.publishUpdate(pageId1, sampleUpdate, { origin: 'client' });

  report('TC-P11-U03: Publisher reports successful broadcast with receivers >= 1', pubResult.success && pubResult.receivers >= 1, `receivers: ${pubResult.receivers}`);

  // Wait for propagation
  await new Promise((r) => setTimeout(r, 150));

  report('TC-P11-U04: Remote instance B received message on page channel', receivedOnB.length === 1);
  if (receivedOnB.length === 1) {
    const isPayloadMatch =
      receivedOnB[0].updateBytes.length === sampleUpdate.length &&
      receivedOnB[0].updateBytes.every((val, idx) => val === sampleUpdate[idx]);
    report('TC-P11-U05: Binary Yjs update decoded with 100% byte fidelity', isPayloadMatch);
    report('TC-P11-U06: Metadata includes publisher instanceId and origin', receivedOnB[0].meta.instanceId === 'test-inst-A' && receivedOnB[0].meta.origin === 'client');
  }

  // --- 3. Loop Prevention / Self-Message Dropping ---
  console.log('\n--- Section 3: Loopback Prevention ---');
  report(
    'TC-P11-U07: Publishing instance A discarded its own published update (no self-echo)',
    receivedOnA.length === 0,
    `receivedOnA count: ${receivedOnA.length}`
  );

  // --- 4. Page Channel Isolation ---
  console.log('\n--- Section 4: Page Channel Isolation ---');
  const receivedOnPage2 = [];
  redisB.subscribeRoom(pageId2, (updateBytes) => {
    receivedOnPage2.push(updateBytes);
  });
  await new Promise((r) => setTimeout(r, 100));

  await redisA.publishUpdate(pageId1, new Uint8Array([99, 100]));
  await new Promise((r) => setTimeout(r, 150));

  report('TC-P11-U08: Subscriber on page2 did NOT receive update published to page1', receivedOnPage2.length === 0);

  // --- 5. Unsubscribe Lifecycle ---
  console.log('\n--- Section 5: Subscription Lifecycle ---');
  await redisB.unsubscribeRoom(pageId1);
  const countBefore = receivedOnB.length;
  await redisA.publishUpdate(pageId1, new Uint8Array([7, 8, 9]));
  await new Promise((r) => setTimeout(r, 150));

  report(
    'TC-P11-U09: Unsubscribed room stops receiving messages on channel',
    receivedOnB.length === countBefore,
    `count: ${receivedOnB.length}`
  );

  // --- 6. Disabled / Fallback Mode ---
  console.log('\n--- Section 6: Disabled & Graceful Shutdown Mode ---');
  const disabledRedis = createCollabRedis({ enabled: false });
  report('TC-P11-U10: Disabled Redis manager reports status "disabled"', disabledRedis.status === 'disabled');
  const disabledPub = await disabledRedis.publishUpdate('any-page', new Uint8Array([1]));
  report('TC-P11-U11: Publishing on disabled Redis returns non-fatal false', disabledPub.success === false && disabledPub.reason === 'disabled');

  await Promise.all([redisA.close(), redisB.close(), disabledRedis.close()]);
  report('TC-P11-U12: Clean client close disconnects both publisher and subscriber', !redisA.isHealthy() && !redisB.isHealthy());

  console.log('\n======================================================================');
  console.log(`TOTAL TESTS: ${passed + failed}`);
  console.log(`PASSED: ${passed}`);
  console.log(`FAILED: ${failed}`);
  console.log('======================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Unhandled test error:', err);
  process.exit(1);
});

