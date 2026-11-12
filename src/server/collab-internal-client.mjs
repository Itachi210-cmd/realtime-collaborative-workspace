/**
 * Collab Internal RPC Client
 * Real-Time Collaborative Workspace - Phase 10 Step 3.2 / 3.4
 *
 * Provides authenticated loopback communication from Next.js server components
 * and API routes to the dedicated collaboration WebSocket server.
 * Enables cross-process document flush before taking version snapshots.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  INTERNAL_RPC_SECRET_REGEX,
  validateInternalRpcSecretValue,
} from '../lib/env.mjs';

function loadEnvIfPresent() {
  if (
    process.env.INTERNAL_RPC_SECRET ||
    process.env.NODE_ENV === 'production' ||
    process.env.NEXT_RUNTIME
  ) {
    return;
  }

  const rootDir = process.cwd();
  const envFiles = [
    path.join(rootDir, /*turbopackIgnore: true*/ '.env.local'),
    path.join(rootDir, /*turbopackIgnore: true*/ '.env'),
  ];

  for (const envPath of envFiles) {
    if (fs.existsSync(/*turbopackIgnore: true*/ envPath)) {
      try {
        const content = fs.readFileSync(/*turbopackIgnore: true*/ envPath, 'utf8');
        for (const line of content.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx > 0) {
            const key = trimmed.slice(0, eqIdx).trim();
            let val = trimmed.slice(eqIdx + 1).trim();
            if (
              (val.startsWith('"') && val.endsWith('"')) ||
              (val.startsWith("'") && val.endsWith("'"))
            ) {
              val = val.slice(1, -1);
            }
            if (!process.env[key]) {
              process.env[key] = val;
            }
          }
        }
      } catch {}
    }
  }
}
loadEnvIfPresent();

const DEFAULT_COLLAB_PORT = 1234;
const DEFAULT_TIMEOUT_MS = 5000;
export { INTERNAL_RPC_SECRET_REGEX };

/**
 * Validates the client-side RPC secret.
 *
 * @param {string} secret
 * @throws {Error} If secret is missing, empty, or not 64 hex characters
 */
export function validateClientRpcSecret(secret) {
  const result = validateInternalRpcSecretValue(secret);
  if (!result.valid) {
    throw new Error(`[CollabInternalClient] Dedicated ${result.error}`);
  }
  return true;
}

/**
 * Sends an internal loopback RPC request to flush an active document in collab-server.
 *
 * @param {string} pageId Document page identifier
 * @param {Object} [options]
 * @param {number} [options.port] Collaboration server port (defaults to COLLAB_PORT or 1234)
 * @param {string} [options.host='127.0.0.1'] Loopback host
 * @param {string} [options.secret] Internal RPC secret (strictly requires dedicated INTERNAL_RPC_SECRET)
 * @param {number} [options.timeoutMs=5000] Timeout in milliseconds
 * @returns {Promise<{ active: boolean, flushed: boolean, stateVersion?: number, serverReachable: boolean }>}
 */
export async function flushActiveRoom(pageId, options = {}) {
  if (!pageId || typeof pageId !== 'string') {
    throw new Error('[CollabInternalClient] Invalid pageId provided to flushActiveRoom');
  }

  const port = options.port || (process.env.COLLAB_PORT ? parseInt(process.env.COLLAB_PORT, 10) : DEFAULT_COLLAB_PORT);
  const host = options.host || '127.0.0.1';
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const secret = options.secret || process.env.INTERNAL_RPC_SECRET;

  validateClientRpcSecret(secret);

  const url = `http://${host}:${port}/internal/rooms/${encodeURIComponent(pageId)}/flush`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${secret}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    const data = await res.json().catch(() => ({}));

    // Handle authentication / permission failure
    if (res.status === 401 || res.status === 403) {
      throw new Error(`[CollabInternalClient] Internal RPC authentication rejected (HTTP ${res.status}): ${data.error || 'Unauthorized'}`);
    }

    // Handle internal server error during flush (active room existed but persistence failed)
    if (res.status === 500 || (res.status >= 400 && data.active)) {
      throw new Error(`[CollabInternalClient] Active room flush failed on collab server (HTTP ${res.status}): ${data.error || 'Persistence error'}`);
    }

    if (!res.ok && res.status !== 404) {
      throw new Error(`[CollabInternalClient] Internal RPC request failed with HTTP ${res.status}: ${data.error || res.statusText}`);
    }

    return {
      active: Boolean(data.active),
      flushed: Boolean(data.flushed),
      stateVersion: data.stateVersion,
      serverReachable: true,
    };
  } catch (err) {
    // Timeout error: must throw so caller does not assume DB is up to date
    if (err.name === 'AbortError' || err.name === 'TimeoutError' || err.message?.includes('aborted')) {
      throw new Error(`[CollabInternalClient] Timeout (${timeoutMs}ms) flushing active room for page "${pageId}"`);
    }

    // Network connection refused: collab server process is not running (no active in-memory room exists)
    if (
      err.cause?.code === 'ECONNREFUSED' ||
      err.code === 'ECONNREFUSED' ||
      err.message?.includes('ECONNREFUSED') ||
      err.message?.includes('fetch failed')
    ) {
      return {
        active: false,
        flushed: false,
        serverReachable: false,
      };
    }

    // Re-throw explicit errors (auth rejected, 500 persistence failure, invalid args)
    throw err;
  }
}

/**
 * Sends an internal loopback RPC request to restore a historical version into an active document room.
 *
 * @param {string} pageId Document page identifier
 * @param {Object} options
 * @param {string} options.versionId Historical version snapshot identifier to restore
 * @param {string} [options.userId] User ID performing the restore (for recovery snapshot authoring)
 * @param {number} [options.port] Collaboration server port (defaults to COLLAB_PORT or 1234)
 * @param {string} [options.host='127.0.0.1'] Loopback host
 * @param {string} [options.secret] Internal RPC secret (strictly requires dedicated INTERNAL_RPC_SECRET)
 * @param {number} [options.timeoutMs=5000] Timeout in milliseconds
 * @returns {Promise<{ success: boolean, restoredVersionId: string, recoverySnapshotId?: string, stateVersion?: number, serverReachable: boolean }>}
 */
export async function restoreActiveRoom(pageId, options = {}) {
  if (!pageId || typeof pageId !== 'string') {
    throw new Error('[CollabInternalClient] Invalid pageId provided to restoreActiveRoom');
  }
  const versionId = options.versionId;
  if (!versionId || typeof versionId !== 'string') {
    throw new Error('[CollabInternalClient] Invalid versionId provided to restoreActiveRoom');
  }

  const port = options.port || (process.env.COLLAB_PORT ? parseInt(process.env.COLLAB_PORT, 10) : DEFAULT_COLLAB_PORT);
  const host = options.host || '127.0.0.1';
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const secret = options.secret || process.env.INTERNAL_RPC_SECRET;

  validateClientRpcSecret(secret);

  const url = `http://${host}:${port}/internal/rooms/${encodeURIComponent(pageId)}/restore`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({
        versionId,
        userId: options.userId || null,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      const err = new Error(
        errorBody.error || `Internal restore RPC failed with status ${response.status}`
      );
      err.status = response.status;
      err.statusCode = response.status;
      err.detail = errorBody.detail;
      throw err;
    }

    const result = await response.json();
    return {
      success: Boolean(result.success),
      restoredVersionId: result.restoredVersionId,
      recoverySnapshotId: result.recoverySnapshotId,
      stateVersion: result.stateVersion,
      serverReachable: true,
    };
  } catch (err) {
    if (err.name === 'AbortError') {
      const timeoutErr = new Error(`Internal restore RPC timed out after ${timeoutMs}ms`);
      timeoutErr.code = 'ETIMEDOUT';
      timeoutErr.serverReachable = false;
      throw timeoutErr;
    }

    if (
      err.code === 'ECONNREFUSED' ||
      err.cause?.code === 'ECONNREFUSED' ||
      err.message?.includes('fetch failed')
    ) {
      const connErr = new Error(`Collaboration server offline at http://${host}:${port}`);
      connErr.code = 'ECONNREFUSED';
      connErr.serverReachable = false;
      connErr.isOfflineFallback = true;
      throw connErr;
    }

    throw err;
  }
}
