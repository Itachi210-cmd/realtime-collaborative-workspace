export const INTERNAL_RPC_SECRET_REGEX: RegExp;

export function validateClientRpcSecret(secret: unknown): boolean;

export interface FlushActiveRoomOptions {
  port?: number;
  host?: string;
  secret?: string;
  timeoutMs?: number;
}

export interface FlushActiveRoomResult {
  active: boolean;
  flushed: boolean;
  stateVersion?: number;
  serverReachable: boolean;
}

export function flushActiveRoom(
  pageId: string,
  options?: FlushActiveRoomOptions
): Promise<FlushActiveRoomResult>;

export interface RestoreActiveRoomOptions {
  versionId: string;
  userId?: string | null;
  port?: number;
  host?: string;
  secret?: string;
  timeoutMs?: number;
}

export interface RestoreActiveRoomResult {
  success: boolean;
  restoredVersionId: string;
  recoverySnapshotId?: string;
  stateVersion?: number;
  serverReachable: boolean;
}

export function restoreActiveRoom(
  pageId: string,
  options: RestoreActiveRoomOptions
): Promise<RestoreActiveRoomResult>;
