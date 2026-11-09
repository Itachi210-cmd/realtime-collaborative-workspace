export interface CollabRedisOptions {
  redisUrl?: string;
  instanceId?: string;
  enabled?: boolean;
  channelPrefix?: string;
  redisOptions?: Record<string, unknown>;
}

export interface DistributedLock {
  acquired: boolean;
  token?: string;
  release?: () => Promise<boolean>;
  error?: string;
}

export interface CollabRedis {
  instanceId: string;
  enabled: boolean;
  readonly status: 'disabled' | 'connecting' | 'ready' | 'closed';
  connect(): Promise<void>;
  publishUpdate(
    pageId: string,
    updateBytes: Uint8Array,
    meta?: { origin?: string }
  ): Promise<{ success: boolean; receivers?: number; error?: string }>;
  publishAwareness(
    pageId: string,
    awarenessBytes: Uint8Array
  ): Promise<{ success: boolean; receivers?: number; error?: string }>;
  publishPersisted(
    pageId: string,
    stateVersion: number
  ): Promise<{ success: boolean; receivers?: number; error?: string }>;
  subscribeRoom(
    pageId: string,
    callback: (updateBytes: Uint8Array | null, payload: Record<string, unknown>) => void
  ): Promise<void> | void;
  unsubscribeRoom(
    pageId: string,
    callback?: (updateBytes: Uint8Array | null, payload: Record<string, unknown>) => void
  ): Promise<void> | void;
  subscribeAwareness(
    pageId: string,
    callback: (awarenessBytes: Uint8Array, payload: Record<string, unknown>) => void
  ): Promise<void> | void;
  unsubscribeAwareness(
    pageId: string,
    callback?: (awarenessBytes: Uint8Array, payload: Record<string, unknown>) => void
  ): Promise<void> | void;
  acquireLock(lockKey: string, ttlMs?: number): Promise<DistributedLock>;
  acquirePersistenceLock(pageId: string, ttlMs?: number): Promise<DistributedLock>;
  acquireRestoreLock(pageId: string, ttlMs?: number): Promise<DistributedLock>;
  isHealthy(): boolean;
  close(): Promise<void>;
  getRoomChannel(pageId: string): string;
  getRoomAwarenessChannel(pageId: string): string;
}

export declare const DEFAULT_REDIS_URL: string;
export declare const CHANNEL_PREFIX: string;

export declare function createCollabRedis(options?: CollabRedisOptions): CollabRedis;
