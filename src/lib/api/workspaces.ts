export interface WorkspaceSummary {
  id: string;
  name: string;
  ownerId: string;
  role: "OWNER" | "EDITOR" | "COMMENTER" | "VIEWER";
  isOwner: boolean;
  membersCount: number;
  pagesCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceMemberInfo {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: "OWNER" | "EDITOR" | "COMMENTER" | "VIEWER";
  joinedAt: string;
}

export interface WorkspaceDetail {
  id: string;
  name: string;
  ownerId: string;
  isOwner: boolean;
  userRole: "OWNER" | "EDITOR" | "COMMENTER" | "VIEWER";
  members: WorkspaceMemberInfo[];
  pagesCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PageItem {
  id: string;
  workspaceId: string;
  parentPageId: string | null;
  title: string;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy?: {
    id: string;
    name: string;
    email: string;
  };
}

export async function getWorkspaces(): Promise<WorkspaceSummary[]> {
  const res = await fetch("/api/workspaces", { cache: "no-store" });
  if (!res.ok) {
    throw new Error("Failed to load workspaces");
  }
  const data = await res.json();
  return data.workspaces || [];
}

export async function createWorkspace(name: string): Promise<WorkspaceSummary> {
  const res = await fetch("/api/workspaces", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "Failed to create workspace");
  }
  const data = await res.json();
  return data.workspace;
}

export async function renameWorkspace(
  workspaceId: string,
  name: string
): Promise<void> {
  const res = await fetch(`/api/workspaces/${workspaceId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "Failed to rename workspace");
  }
}

export async function deleteWorkspace(workspaceId: string): Promise<void> {
  const res = await fetch(`/api/workspaces/${workspaceId}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "Failed to delete workspace");
  }
}

export async function getWorkspacePages(
  workspaceId: string
): Promise<PageItem[]> {
  const res = await fetch(`/api/workspaces/${workspaceId}/pages`, {
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error("Failed to load pages");
  }
  const data = await res.json();
  return data.pages || [];
}

export async function createPage(
  workspaceId: string,
  title: string,
  parentPageId?: string | null
): Promise<PageItem> {
  const res = await fetch(`/api/workspaces/${workspaceId}/pages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, parentPageId }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "Failed to create page");
  }
  const data = await res.json();
  return data.page;
}

export async function renamePage(
  workspaceId: string,
  pageId: string,
  title: string
): Promise<PageItem> {
  const res = await fetch(`/api/workspaces/${workspaceId}/pages/${pageId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "Failed to rename page");
  }
  const data = await res.json();
  return data.page;
}

export async function deletePage(
  workspaceId: string,
  pageId: string
): Promise<void> {
  const res = await fetch(`/api/workspaces/${workspaceId}/pages/${pageId}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "Failed to delete page");
  }
}

