export type UserRole = "OWNER" | "EDITOR" | "COMMENTER" | "VIEWER";

export interface User {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
}

export interface Workspace {
  id: string;
  name: string;
  ownerId: string;
  icon?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface WorkspaceMember {
  id: string;
  workspaceId: string;
  userId: string;
  role: UserRole;
  joinedAt: string;
}

export interface PageItem {
  id: string;
  workspaceId: string;
  parentPageId?: string | null;
  title: string;
  icon?: string;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export type CollabSyncStatus = "connecting" | "live" | "reconnecting" | "offline";

