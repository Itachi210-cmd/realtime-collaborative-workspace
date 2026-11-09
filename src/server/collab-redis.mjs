/**
 * Redis Pub/Sub Collaboration Service
 * Real-Time Collaborative Workspace - Phase 11 Step 1 & Step 2
 *
 * Provides dedicated Redis publishing and subscribing connections for multi-instance
 * WebSocket server synchronization. Propagates Yjs document updates and distributed awareness
 * (cursors, avatars, presence) across independent server processes with loopback prevention,
 * instance identification, distributed locking, and graceful shutdown.
 */

import crypto from 'node:crypto';
import Redis from 'ioredis';

export const DEFAULT_REDIS_URL = 'redis://localhost:6379';
export const CHANNEL_PREFIX = 'collab:room';

/**
 * Creates and configures the Redis Pub/Sub manager for a collaboration server instance.
 *
 * @param {Object} [options]
 * @param {string} [options.redisUrl] Connection string (e.g. redis://localhost:6379)
 * @param {string} [options.instanceId] Unique identifier for this server instance
 * @param {boolean} [options.enabled=true] Whether Redis pub/sub is enabled
 * @param {string} [options.channelPrefix] Custom prefix for pub/sub channels
 * @param {Object} [options.redisOptions] Custom ioredis options
 * @returns {Object} Redis manager instance
 */
export function createCollabRedis(options = {}) {
  const enabled = options.enabled !== false && process.env.REDIS_ENABLED !== 'false';
  const rawUrl = options.redisUrl || process.env.REDIS_URL || DEFAULT_REDIS_URL;
  const instanceId = options.instanceId || `collab-${crypto.randomUUID()}`;
  const prefix = options.channelPrefix || CHANNEL_PREFIX;

  if (!enabled || rawUrl === 'disabled') {
    console.log(`[CollabRedis] Redis pub/sub is disabled for instance "${instanceId}".`);
    return {
      instanceId,
      enabled: false,
      status: 'disabled',
      connect: async () => {},
      publishUpdate: async () => ({ success: false, reason: 'disabled' }),
      publishAwareness: async () => ({ success: false, reason: 'disabled' }),
      publishPersisted: async () => ({ success: false, reason: 'disabled' }),
      subscribeRoom: () => {},
      unsubscribeRoom: () => {},
      subscribeAwareness: () => {},
      unsubscribeAwareness: () => {},
      acquireLock: async () => ({ acquired: true, token: 'disabled-local', release: async () => true }),
      acquirePersistenceLock: async () => ({ acquired: true, token: 'disabled-local', release: async () => true }),
      acquireRestoreLock: async () => ({ acquired: true, token: 'disabled-local', release: async () => true }),
      close: async () => {},
      isHealthy: () => false,
      getRoomChannel: (id) => `${prefix}:${id}:updates`,
      getRoomAwarenessChannel: (id) => `${prefix}:${id}:awareness`,
    };
  }

  // Active channel subscription callbacks: Map<channel, Set<Function>>
  const channelCallbacks = new Map();
  // Room tracking: Map<pageId, { updateChannel: string, awarenessChannel: string }>
  const roomChannels = new Map();

  let pubClient = null;
  let subClient = null;
  let isConnected = false;
  let isClosed = false;

  const defaultClientOptions = {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: true,
    retryStrategy(times) {
      if (isClosed) return null;
      const delay = Math.min(times * 100, 3000);
      console.warn(`[CollabRedis] Reconnecting to Redis in ${delay}ms (attempt ${times})...`);
      return delay;
    },
    ...options.redisOptions,
  };

  /**
   * Builds the Redis pub/sub channel name for document updates.
   *
   * @param {string} pageId
   * @returns {string} Channel name (e.g. "collab:room:cmw123:updates")
   */
  function getRoomChannel(pageId) {
    return `${prefix}:${pageId}:updates`;
  }

  /**
   * Builds the Redis pub/sub channel name for ephemeral awareness updates.
   *
   * @param {string} pageId
   * @returns {string} Channel name (e.g. "collab:room:cmw123:awareness")
   */
  function getRoomAwarenessChannel(pageId) {
    return `${prefix}:${pageId}:awareness`;
  }

  /**
   * Initializes both dedicated Redis clients and establishes connections.
   */
  async function connect() {
    if (isClosed) return;
    if (isConnected) return;

    try {
      console.log(`[CollabRedis] Connecting to Redis at ${rawUrl} (instance: ${instanceId})...`);

      pubClient = new Redis(rawUrl, {
        ...defaultClientOptions,
        connectionName: `${instanceId}-pub`,
      });

      subClient = new Redis(rawUrl, {
        ...defaultClientOptions,
        connectionName: `${instanceId}-sub`,
      });

      // Error and Lifecycle event logging for pubClient
      pubClient.on('error', (err) => {
        console.error(`[CollabRedis] Publisher error on instance "${instanceId}":`, err.message);
      });
      pubClient.on('ready', () => {
        console.log(`[CollabRedis] Publisher ready on instance "${instanceId}"`);
      });

      // Error and Lifecycle event logging for subClient
      subClient.on('error', (err) => {
        console.error(`[CollabRedis] Subscriber error on instance "${instanceId}":`, err.message);
      });
      subClient.on('ready', () => {
        console.log(`[CollabRedis] Subscriber ready on instance "${instanceId}"`);
      });

      // Centralized message dispatcher for the dedicated subscriber
      subClient.on('message', (channel, messageText) => {
        const callbacks = channelCallbacks.get(channel);
        if (!callbacks || callbacks.size === 0) return;

        let payload;
        try {
          payload = JSON.parse(messageText);
        } catch (err) {
          console.warn(`[CollabRedis] Received malformed JSON on channel "${channel}":`, err.message);
          return;
        }

        // Loop prevention: Discard messages published by this exact instance
        if (payload.instanceId === instanceId) {
          return;
        }

        // 1. Yjs Document Update Message
        if (payload.type === 'yjs_update') {
          if (!payload.update || typeof payload.update !== 'string') return;

          let updateBytes;
          try {
            updateBytes = new Uint8Array(Buffer.from(payload.update, 'base64'));
          } catch (err) {
            console.error(`[CollabRedis] Failed decoding base64 update on channel "${channel}":`, err.message);
            return;
          }

          for (const callback of callbacks) {
            try {
              callback(updateBytes, payload);
            } catch (err) {
              console.error(`[CollabRedis] Error in update subscriber callback for "${channel}":`, err);
            }
          }
          return;
        }

        // 2. Yjs Awareness (Presence, Avatars, Cursors) Message
        if (payload.type === 'yjs_awareness') {
          if (!payload.awareness || typeof payload.awareness !== 'string') return;

          let awarenessBytes;
          try {
            awarenessBytes = new Uint8Array(Buffer.from(payload.awareness, 'base64'));
          } catch (err) {
            console.error(`[CollabRedis] Failed decoding base64 awareness on channel "${channel}":`, err.message);
            return;
          }

          for (const callback of callbacks) {
            try {
              callback(awarenessBytes, payload);
            } catch (err) {
              console.error(`[CollabRedis] Error in awareness subscriber callback for "${channel}":`, err);
            }
          }
          return;
        }

        // 3. Document Persisted Notification Message
        if (payload.type === 'yjs_persisted') {
          for (const callback of callbacks) {
            try {
              callback(null, payload);
            } catch (err) {
              console.error(`[CollabRedis] Error in persisted subscriber callback for "${channel}":`, err);
            }
          }
          return;
        }
      });

      await Promise.all([pubClient.connect(), subClient.connect()]);
      isConnected = true;
      console.log(`[CollabRedis] Successfully connected to Redis (instance: ${instanceId})`);
    } catch (err) {
      console.error(`[CollabRedis] Fatal connection failure to Redis at ${rawUrl}:`, err.message);
      throw err;
    }
  }

  /**
   * Publishes a validated Yjs document update to Redis for cross-instance propagation.
   *
   * @param {string} pageId Document room identifier
   * @param {Uint8Array} updateBytes Yjs incremental update bytes
   * @param {Object} [meta] Additional metadata
   * @param {string} [meta.origin='client'] Origin category (e.g. 'client', 'restore')
   * @returns {Promise<{ success: boolean, receivers?: number, error?: string }>}
   */
  async function publishUpdate(pageId, updateBytes, meta = {}) {
    if (isClosed || !isConnected || !pubClient) {
      return { success: false, error: 'Redis client not connected' };
    }
    if (!pageId || !updateBytes || updateBytes.length === 0) {
      return { success: false, error: 'Invalid update payload or pageId' };
    }

    const channel = getRoomChannel(pageId);
    const payload = {
      type: 'yjs_update',
      instanceId,
      pageId,
      origin: meta.origin || 'client',
      timestamp: Date.now(),
      update: Buffer.from(updateBytes).toString('base64'),
    };

    try {
      const messageString = JSON.stringify(payload);
      const receivers = await pubClient.publish(channel, messageString);
      return { success: true, receivers };
    } catch (err) {
      console.error(`[CollabRedis] Error publishing update for room "${pageId}":`, err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Publishes an awareness update (cursor moves, presence changes, user disconnect removals).
   *
   * @param {string} pageId Document room identifier
   * @param {Uint8Array} awarenessBytes Encoded awareness update
   * @returns {Promise<{ success: boolean, receivers?: number, error?: string }>}
   */
  async function publishAwareness(pageId, awarenessBytes) {
    if (isClosed || !isConnected || !pubClient) {
      return { success: false, error: 'Redis client not connected' };
    }
    if (!pageId || !awarenessBytes || awarenessBytes.length === 0) {
      return { success: false, error: 'Invalid awareness payload or pageId' };
    }

    const channel = getRoomAwarenessChannel(pageId);
    const payload = {
      type: 'yjs_awareness',
      instanceId,
      pageId,
      timestamp: Date.now(),
      awareness: Buffer.from(awarenessBytes).toString('base64'),
    };

    try {
      const messageString = JSON.stringify(payload);
      const receivers = await pubClient.publish(channel, messageString);
      return { success: true, receivers };
    } catch (err) {
      console.error(`[CollabRedis] Error publishing awareness for room "${pageId}":`, err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Publishes notification that document state has been successfully persisted to PostgreSQL.
   *
   * @param {string} pageId
   * @param {number} stateVersion
   * @returns {Promise<{ success: boolean, receivers?: number }>}
   */
  async function publishPersisted(pageId, stateVersion) {
    if (isClosed || !isConnected || !pubClient) {
      return { success: false, error: 'Redis client not connected' };
    }

    const channel = getRoomChannel(pageId);
    const payload = {
      type: 'yjs_persisted',
      instanceId,
      pageId,
      stateVersion,
      timestamp: Date.now(),
    };

    try {
      const receivers = await pubClient.publish(channel, JSON.stringify(payload));
      return { success: true, receivers };
    } catch (err) {
      console.error(`[CollabRedis] Error publishing persisted event for room "${pageId}":`, err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Subscribes to Redis updates for a specific document room.
   *
   * @param {string} pageId
   * @param {(updateBytes: Uint8Array|null, payload: Object) => void} callback
   */
  async function subscribeRoom(pageId, callback) {
    if (isClosed || !pageId || typeof callback !== 'function') return;

    const channel = getRoomChannel(pageId);
    let callbacks = channelCallbacks.get(channel);
    const isFirstSubscriber = !callbacks || callbacks.size === 0;

    if (!callbacks) {
      callbacks = new Set();
      channelCallbacks.set(channel, callbacks);
    }
    callbacks.add(callback);

    if (isFirstSubscriber && subClient && isConnected) {
      try {
        await subClient.subscribe(channel);
      } catch (err) {
        console.error(`[CollabRedis] Failed subscribing to channel "${channel}":`, err.message);
      }
    }
  }

  /**
   * Unsubscribes an update listener when a room is destroyed.
   *
   * @param {string} pageId
   * @param {Function} [callback]
   */
  async function unsubscribeRoom(pageId, callback) {
    if (!pageId) return;

    const channel = getRoomChannel(pageId);
    const callbacks = channelCallbacks.get(channel);

    if (callbacks) {
      if (callback) {
        callbacks.delete(callback);
      } else {
        callbacks.clear();
      }

      if (callbacks.size === 0) {
        channelCallbacks.delete(channel);
        if (subClient && isConnected && !isClosed) {
          try {
            await subClient.unsubscribe(channel);
          } catch (err) {
            console.error(`[CollabRedis] Failed unsubscribing from channel "${channel}":`, err.message);
          }
        }
      }
    }
  }

  /**
   * Subscribes to cross-instance awareness updates for a specific document room.
   *
   * @param {string} pageId
   * @param {(awarenessBytes: Uint8Array, payload: Object) => void} callback
   */
  async function subscribeAwareness(pageId, callback) {
    if (isClosed || !pageId || typeof callback !== 'function') return;

    const channel = getRoomAwarenessChannel(pageId);
    let callbacks = channelCallbacks.get(channel);
    const isFirstSubscriber = !callbacks || callbacks.size === 0;

    if (!callbacks) {
      callbacks = new Set();
      channelCallbacks.set(channel, callbacks);
    }
    callbacks.add(callback);

    if (isFirstSubscriber && subClient && isConnected) {
      try {
        await subClient.subscribe(channel);
      } catch (err) {
        console.error(`[CollabRedis] Failed subscribing to awareness channel "${channel}":`, err.message);
      }
    }
  }

  /**
   * Unsubscribes an awareness listener when a room is destroyed.
   *
   * @param {string} pageId
   * @param {Function} [callback]
   */
  async function unsubscribeAwareness(pageId, callback) {
    if (!pageId) return;

    const channel = getRoomAwarenessChannel(pageId);
    const callbacks = channelCallbacks.get(channel);

    if (callbacks) {
      if (callback) {
        callbacks.delete(callback);
      } else {
        callbacks.clear();
      }

      if (callbacks.size === 0) {
        channelCallbacks.delete(channel);
        if (subClient && isConnected && !isClosed) {
          try {
            await subClient.unsubscribe(channel);
          } catch (err) {
            console.error(`[CollabRedis] Failed unsubscribing from awareness channel "${channel}":`, err.message);
          }
        }
      }
    }
  }

  /**
   * Distributed Lock Acquisition via Redis SET key token NX PX ttlMs.
   * Uses safe atomic release with Lua script.
   *
   * @param {string} lockKey Full Redis key for the lock
   * @param {number} [ttlMs=10000] Time to live in milliseconds (auto-expiration on crash)
   * @returns {Promise<{ acquired: boolean, token?: string, release?: () => Promise<boolean>, error?: string }>}
   */
  async function acquireLock(lockKey, ttlMs = 10000) {
    if (isClosed || !isConnected || !pubClient) {
      // Local fallback if Redis is disabled
      return {
        acquired: true,
        token: `local-${instanceId}`,
        release: async () => true,
      };
    }

    const token = `${instanceId}:${crypto.randomUUID()}`;
    try {
      const result = await pubClient.set(lockKey, token, 'PX', ttlMs, 'NX');
      if (result === 'OK') {
        let released = false;
        return {
          acquired: true,
          token,
          release: async () => {
            if (released || !pubClient || !isConnected) return true;
            released = true;
            const lua = `
              if redis.call("get", KEYS[1]) == ARGV[1] then
                return redis.call("del", KEYS[1])
              else
                return 0
              end
            `;
            try {
              const delResult = await pubClient.eval(lua, 1, lockKey, token);
              return delResult === 1;
            } catch (err) {
              console.warn(`[CollabRedis] Error releasing lock "${lockKey}":`, err.message);
              return false;
            }
          },
        };
      }
      return { acquired: false };
    } catch (err) {
      console.error(`[CollabRedis] Error acquiring lock "${lockKey}":`, err.message);
      return { acquired: false, error: err.message };
    }
  }

  /**
   * Distributed persistence lock helper.
   */
  function acquirePersistenceLock(pageId, ttlMs = 10000) {
    return acquireLock(`${prefix}:lock:persist:${pageId}`, ttlMs);
  }

  /**
   * Distributed restore mutex helper preventing concurrent restore operations across instances.
   */
  function acquireRestoreLock(pageId, ttlMs = 15000) {
    return acquireLock(`${prefix}:lock:restore:${pageId}`, ttlMs);
  }

  /**
   * Returns current health and connection state.
   */
  function isHealthy() {
    return isConnected && !isClosed && pubClient?.status === 'ready' && subClient?.status === 'ready';
  }

  /**
   * Gracefully shuts down all Redis client connections and active subscriptions.
   */
  async function close() {
    if (isClosed) return;
    isClosed = true;
    isConnected = false;

    channelCallbacks.clear();
    roomChannels.clear();

    const closeClient = async (client, name) => {
      if (!client) return;
      try {
        if (client.status === 'ready' || client.status === 'connect') {
          await client.quit();
        } else {
          client.disconnect();
        }
      } catch (err) {
        console.warn(`[CollabRedis] Error closing ${name} client:`, err.message);
        client.disconnect();
      }
    };

    await Promise.allSettled([
      closeClient(pubClient, 'publisher'),
      closeClient(subClient, 'subscriber'),
    ]);

    pubClient = null;
    subClient = null;
    console.log(`[CollabRedis] Disconnected and closed Redis clients for instance "${instanceId}"`);
  }

  return {
    instanceId,
    enabled: true,
    get status() {
      if (!isConnected) return 'connecting';
      if (isClosed) return 'closed';
      return pubClient?.status === 'ready' && subClient?.status === 'ready' ? 'ready' : 'connecting';
    },
    connect,
    publishUpdate,
    publishAwareness,
    publishPersisted,
    subscribeRoom,
    unsubscribeRoom,
    subscribeAwareness,
    unsubscribeAwareness,
    acquireLock,
    acquirePersistenceLock,
    acquireRestoreLock,
    isHealthy,
    close,
    getRoomChannel,
    getRoomAwarenessChannel,
  };
}
