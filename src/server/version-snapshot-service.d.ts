import type { PrismaClient } from "@prisma/client";
import type * as Y from "yjs";

export interface VersionSnapshotRecord {
  id: string;
  pageId: string;
  createdById: string | null;
  label: string | null;
  description: string | null;
  yjsState: Buffer | Uint8Array;
  content: unknown | null;
  wordCount: number | null;
  isAutomatic: boolean;
  createdAt: Date;
  createdBy: {
    id: string;
    name: string;
    email: string;
  } | null;
}

export interface VersionSnapshotSummary {
  id: string;
  pageId: string;
  createdById: string | null;
  label: string | null;
  description: string | null;
  wordCount: number | null;
  isAutomatic: boolean;
  createdAt: Date;
  createdBy: {
    id: string;
    name: string;
    email: string;
  } | null;
}

export interface CreateSnapshotParams {
  userId?: string | null;
  label?: string | null;
  description?: string | null;
  isAutomatic?: boolean;
  doc?: Y.Doc | null;
  prisma?: PrismaClient;
  collabPort?: number;
  internalRpcSecret?: string;
  rpcTimeoutMs?: number;
  flushActiveRoom?: (
    pageId: string,
    options?: { port?: number; secret?: string; timeoutMs?: number }
  ) => Promise<{ active: boolean; flushed: boolean; stateVersion?: number; serverReachable: boolean }>;
}

export interface RestoreSnapshotParams {
  userId?: string | null;
  prisma?: PrismaClient;
  collabPort?: number;
  internalRpcSecret?: string;
  rpcTimeoutMs?: number;
  restoreActiveRoom?: (
    pageId: string,
    options: {
      versionId: string;
      userId?: string | null;
      port?: number;
      secret?: string;
      timeoutMs?: number;
    }
  ) => Promise<{
    success: boolean;
    restoredVersionId: string;
    recoverySnapshotId?: string;
    stateVersion?: number;
    serverReachable: boolean;
  }>;
}

export interface RestoreSnapshotResult {
  success: boolean;
  restoredVersion: VersionSnapshotRecord;
  recoverySnapshot: VersionSnapshotRecord | null;
}

export function extractTextFromProseMirror(node: unknown): string;

export function calculateWordCount(contentJson: unknown): number;

export function getActiveRoomDoc(pageId: string): Y.Doc | null;

export function createVersionSnapshot(
  pageId: string,
  params?: CreateSnapshotParams
): Promise<VersionSnapshotRecord>;

export function createRecoverySnapshot(
  pageId: string,
  params?: CreateSnapshotParams & { triggerAction?: string }
): Promise<VersionSnapshotRecord>;

export function listVersionSnapshots(
  pageId: string,
  options?: { limit?: number; prisma?: PrismaClient }
): Promise<VersionSnapshotSummary[]>;

export function getVersionSnapshot(
  pageId: string,
  snapshotId: string,
  options?: { prisma?: PrismaClient }
): Promise<VersionSnapshotRecord | null>;

export function replaceDocXmlFragment(targetDoc: Y.Doc, sourceDoc: Y.Doc): void;

export function restoreVersionSnapshot(
  pageId: string,
  snapshotId: string,
  params?: RestoreSnapshotParams
): Promise<RestoreSnapshotResult>;
