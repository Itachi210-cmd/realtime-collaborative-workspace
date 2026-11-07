import { EventEmitter } from "node:events";
import type { Page } from "@prisma/client";

export type WorkspacePageEventType =
  | "PAGE_CREATED"
  | "PAGE_UPDATED"
  | "PAGE_DELETED";

export interface PageCreatedPayload {
  type: "PAGE_CREATED";
  page: Partial<Page> & { id: string; title: string; parentPageId?: string | null; workspaceId: string };
}

export interface PageUpdatedPayload {
  type: "PAGE_UPDATED";
  page: Partial<Page> & { id: string; title: string; parentPageId?: string | null; workspaceId: string };
}

export interface PageDeletedPayload {
  type: "PAGE_DELETED";
  pageId: string;
  workspaceId: string;
}

export type WorkspacePageEvent =
  | PageCreatedPayload
  | PageUpdatedPayload
  | PageDeletedPayload;

class WorkspaceEventEmitter extends EventEmitter {
  constructor() {
    super();
    // Allow ample listeners for concurrent workspace connections
    this.setMaxListeners(200);
  }

  emitWorkspaceEvent(workspaceId: string, event: WorkspacePageEvent) {
    this.emit(`workspace:${workspaceId}`, event);
  }

  onWorkspaceEvent(
    workspaceId: string,
    listener: (event: WorkspacePageEvent) => void
  ) {
    this.on(`workspace:${workspaceId}`, listener);
  }

  offWorkspaceEvent(
    workspaceId: string,
    listener: (event: WorkspacePageEvent) => void
  ) {
    this.off(`workspace:${workspaceId}`, listener);
  }
}

// Preserve singleton instance across Next.js Fast Refresh and HMR in development
const globalForEvents = globalThis as unknown as {
  workspaceEvents?: WorkspaceEventEmitter;
};

export const workspaceEvents =
  globalForEvents.workspaceEvents || new WorkspaceEventEmitter();

if (process.env.NODE_ENV !== "production") {
  globalForEvents.workspaceEvents = workspaceEvents;
}

