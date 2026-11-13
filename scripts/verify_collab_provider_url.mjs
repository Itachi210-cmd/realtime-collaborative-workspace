/**
 * Verification Suite: Collab Provider WebSocket URL Resolution
 *
 * Verifies that:
 * 1. Production HTTPS browser sessions always use secure WSS (never insecure ws://localhost).
 * 2. Insecure build-time defaults (e.g., ws://localhost:1234) are ignored on HTTPS.
 * 3. Explicitly configured valid wss:// URLs are respected.
 * 4. Local development HTTP behavior (localhost and LAN hostnames) is preserved.
 * 5. SSR / non-browser fallback behavior remains intact.
 */

import assert from 'node:assert/strict';
import { getDefaultCollabWsUrl } from '../src/lib/collab/collab-provider.mjs';

const originalWindow = global.window;
const originalEnv = process.env.NEXT_PUBLIC_COLLAB_WS_URL;

function runSuite() {
  console.log('=== Running Collab Provider URL Resolution Tests ===\n');
  let passed = 0;
  let total = 0;

  function test(name, fn) {
    total++;
    try {
      fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`[FAIL] ${name}:`, err.message);
      throw err;
    } finally {
      // Clean up after each test
      global.window = originalWindow;
      if (originalEnv === undefined) {
        delete process.env.NEXT_PUBLIC_COLLAB_WS_URL;
      } else {
        process.env.NEXT_PUBLIC_COLLAB_WS_URL = originalEnv;
      }
    }
  }

  // 1. Production HTTPS browser session with no configured URL
  test('HTTPS browser without env var resolves to wss://${host}/collab-ws', () => {
    delete process.env.NEXT_PUBLIC_COLLAB_WS_URL;
    global.window = {
      location: {
        protocol: 'https:',
        host: 'collab-workspace-h7od.onrender.com',
        hostname: 'collab-workspace-h7od.onrender.com',
      },
    };
    const url = getDefaultCollabWsUrl();
    assert.equal(url, 'wss://collab-workspace-h7od.onrender.com/collab-ws');
  });

  // 2. Production HTTPS browser session with baked Docker default (ws://localhost:1234)
  test('HTTPS browser ignores insecure ws://localhost build-time default and uses WSS', () => {
    process.env.NEXT_PUBLIC_COLLAB_WS_URL = 'ws://localhost:1234';
    global.window = {
      location: {
        protocol: 'https:',
        host: 'collab-workspace-h7od.onrender.com',
        hostname: 'collab-workspace-h7od.onrender.com',
      },
    };
    const url = getDefaultCollabWsUrl();
    assert.equal(
      url,
      'wss://collab-workspace-h7od.onrender.com/collab-ws',
      'Must NOT use insecure ws://localhost on an HTTPS browser session'
    );
  });

  // 3. Production HTTPS browser session with explicit valid secure wss:// URL
  test('HTTPS browser respects explicitly configured secure wss:// URL', () => {
    process.env.NEXT_PUBLIC_COLLAB_WS_URL = 'wss://collab-workspace-h7od.onrender.com';
    global.window = {
      location: {
        protocol: 'https:',
        host: 'collab-workspace-h7od.onrender.com',
        hostname: 'collab-workspace-h7od.onrender.com',
      },
    };
    const url = getDefaultCollabWsUrl();
    assert.equal(url, 'wss://collab-workspace-h7od.onrender.com');
  });

  // 4. Production HTTPS browser session with trailing slash in wss:// URL
  test('HTTPS browser trims trailing slash from configured wss:// URL', () => {
    process.env.NEXT_PUBLIC_COLLAB_WS_URL = 'wss://collab-workspace-h7od.onrender.com/';
    global.window = {
      location: {
        protocol: 'https:',
        host: 'collab-workspace-h7od.onrender.com',
        hostname: 'collab-workspace-h7od.onrender.com',
      },
    };
    const url = getDefaultCollabWsUrl();
    assert.equal(url, 'wss://collab-workspace-h7od.onrender.com');
  });

  // 5. Local development HTTP browser session with no configured URL
  test('HTTP browser (localhost) resolves to ws://localhost:1234', () => {
    delete process.env.NEXT_PUBLIC_COLLAB_WS_URL;
    global.window = {
      location: {
        protocol: 'http:',
        host: 'localhost:3000',
        hostname: 'localhost',
      },
    };
    const url = getDefaultCollabWsUrl();
    assert.equal(url, 'ws://localhost:1234');
  });

  // 6. Local development HTTP browser session with LAN hostname
  test('HTTP browser with LAN IP resolves to ws://${hostname}:1234', () => {
    delete process.env.NEXT_PUBLIC_COLLAB_WS_URL;
    global.window = {
      location: {
        protocol: 'http:',
        host: '192.168.1.42:3000',
        hostname: '192.168.1.42',
      },
    };
    const url = getDefaultCollabWsUrl();
    assert.equal(url, 'ws://192.168.1.42:1234');
  });

  // 7. Local development HTTP browser session with configured ws:// URL
  test('HTTP browser respects configured ws:// URL', () => {
    process.env.NEXT_PUBLIC_COLLAB_WS_URL = 'ws://localhost:1234';
    global.window = {
      location: {
        protocol: 'http:',
        host: 'localhost:3000',
        hostname: 'localhost',
      },
    };
    const url = getDefaultCollabWsUrl();
    assert.equal(url, 'ws://localhost:1234');
  });

  // 8. SSR / Node environment fallback
  test('SSR / Node environment fallback behaves as expected', () => {
    delete global.window;
    delete process.env.NEXT_PUBLIC_COLLAB_WS_URL;
    assert.equal(getDefaultCollabWsUrl(), 'ws://localhost:1234');

    process.env.NEXT_PUBLIC_COLLAB_WS_URL = 'wss://custom-domain.com';
    assert.equal(getDefaultCollabWsUrl(), 'wss://custom-domain.com');
  });

  console.log(`\n==============================================`);
  console.log(`RESULTS: ${passed}/${total} tests passed successfully.`);
  console.log(`==============================================\n`);
}

runSuite();
