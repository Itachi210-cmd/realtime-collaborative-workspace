/**
 * Yjs Collaborative WebSocket Provider Setup
 * Real-Time Collaborative Workspace - Phase 6 Step 3
 *
 * Configures y-websocket's WebsocketProvider with the secure AuthenticatedWebSocket
 * transport, manages connection status transitions, ensures fresh tokens on reconnect,
 * and terminates reconnects on permanent authorization errors.
 */

import { WebsocketProvider } from 'y-websocket';
import { createAuthenticatedWebSocketClass } from './authenticated-transport.mjs';

/**
 * Fetches a short-lived collaboration token from the Next.js API.
 * Never logs the token or credentials.
 *
 * @param {string} workspaceId
 * @param {string} pageId
 * @returns {Promise<string>}
 */
export async function fetchCollabToken(workspaceId, pageId) {
  const res = await fetch(`/api/workspaces/${workspaceId}/pages/${pageId}/collab-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    const error = new Error(
      errorBody.error || `Failed to acquire collaboration token (HTTP ${res.status})`
    );
    error.status = res.status;
    throw error;
  }

  const data = await res.json();
  if (!data?.token || typeof data.token !== 'string') {
    throw new Error('Invalid token response received from collaboration token API.');
  }

  return data.token;
}

/**
 * Determines the default WebSocket URL for the collaboration server.
 * Uses NEXT_PUBLIC_COLLAB_WS_URL if defined; otherwise dynamically resolves
 * to the current window hostname to support localhost, 127.0.0.1, and LAN IP addresses.
 *
 * @returns {string}
 */
export function getDefaultCollabWsUrl() {
  if (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_COLLAB_WS_URL) {
    return process.env.NEXT_PUBLIC_COLLAB_WS_URL;
  }
  if (typeof window !== 'undefined' && window.location) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const hostname = window.location.hostname || 'localhost';
    return `${protocol}//${hostname}:1234`;
  }
  return 'ws://localhost:1234';
}

/**
 * Initializes and configures an authenticated Yjs WebsocketProvider for a page.
 *
 * @param {Object} options
 * @param {string} options.workspaceId
 * @param {string} options.pageId
 * @param {any} options.ydoc
 * @param {any} [options.awareness]
 * @param {string} [options.serverUrl]
 * @param {() => Promise<string>} [options.getToken]
 * @param {(status: string, error?: string | null) => void} [options.onStatusChange]
 * @param {any} [options.BaseWS]
 * @param {boolean} [options.disableBc]
 * @returns {WebsocketProvider}
 */
export function createCollabWebsocketProvider({
  workspaceId,
  pageId,
  ydoc,
  awareness,
  serverUrl = getDefaultCollabWsUrl(),
  getToken,
  onStatusChange,
  BaseWS,
  disableBc = false,
}) {
  let hasEverConnected = false;
  let isPermanentAuthFailure = false;

  const notifyStatus = (status, error = null) => {
    if (onStatusChange) {
      onStatusChange(status, error);
    }
  };

  // Initial state: connecting
  notifyStatus('connecting');

  // Token getter: uses provided getter or calls the Next.js collab-token endpoint
  const tokenGetter = getToken || (() => fetchCollabToken(workspaceId, pageId));

  // Custom Authenticated WebSocket class configured with token getter
  const AuthWebSocketClass = createAuthenticatedWebSocketClass(tokenGetter, BaseWS);

  // Custom shouldReconnect predicate: halt reconnects on permanent 44xx codes or auth failure
  const shouldReconnect = (event) => {
    if (isPermanentAuthFailure) return false;
    if (event && event.code >= 4400 && event.code < 4500) {
      return false;
    }
    return true;
  };

  const provider = new WebsocketProvider(serverUrl, pageId, ydoc, {
    WebSocketPolyfill: AuthWebSocketClass,
    shouldReconnect,
    disableBc,
    maxBackoffTime: 5000,
    ...(awareness ? { awareness } : {}),
  });

  // Track provider status events
  provider.on('status', ({ status }) => {
    if (isPermanentAuthFailure) return;

    if (status === 'connected') {
      hasEverConnected = true;
      notifyStatus('connected');
    } else if (status === 'connecting') {
      if (hasEverConnected) {
        notifyStatus('reconnecting');
      } else {
        notifyStatus('connecting');
      }
    } else if (status === 'disconnected') {
      if (hasEverConnected) {
        notifyStatus('reconnecting');
      } else {
        notifyStatus('disconnected');
      }
    }
  });

  // Sync event: ensures connected state is reflected when synchronization completes
  provider.on('sync', (isSynced) => {
    if (isPermanentAuthFailure) return;
    if (isSynced) {
      notifyStatus('connected');
    }
  });

  // Terminal close event: server or transport signaled that reconnecting is useless
  provider.on('closed', (event) => {
    if (event.code === 4401 || event.code === 4403 || (event.code >= 4400 && event.code < 4500)) {
      isPermanentAuthFailure = true;
      provider.shouldConnect = false;
      notifyStatus('auth_error', event.reason || 'Authentication or permission denied');
    } else {
      notifyStatus('disconnected', event.reason);
    }
  });

  // Connection error handling
  provider.on('connection-error', (event) => {
    if (isPermanentAuthFailure) return;
    console.warn(`[CollabProvider] Connection error on room "${pageId}":`, event?.message || event);
  });

  return provider;
}

