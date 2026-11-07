export type WorkspaceRole = "OWNER" | "EDITOR" | "COMMENTER" | "VIEWER";

export interface WorkspaceMemberRecord {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: WorkspaceRole;
  joinedAt?: string;
  isOwner?: boolean;
}

export async function getWorkspaceMembers(
  workspaceId: string,
  signal?: AbortSignal
): Promise<WorkspaceMemberRecord[]> {
  const res = await fetch(`/api/workspaces/${workspaceId}/members`, {
    cache: "no-store",
    signal,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to load workspace members.");
  }

  const data = await res.json();
  return data.members || [];
}

export async function addWorkspaceMember(
  workspaceId: string,
  email: string,
  role: "EDITOR" | "COMMENTER" | "VIEWER"
): Promise<WorkspaceMemberRecord> {
  const res = await fetch(`/api/workspaces/${workspaceId}/members`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, role }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to add member to workspace.");
  }

  const data = await res.json();
  return data.member;
}

export async function updateWorkspaceMemberRole(
  workspaceId: string,
  memberId: string,
  role: "EDITOR" | "COMMENTER" | "VIEWER"
): Promise<WorkspaceMemberRecord> {
  const res = await fetch(
    `/api/workspaces/${workspaceId}/members/${memberId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to update member role.");
  }

  const data = await res.json();
  return data.member;
}

export async function removeWorkspaceMember(
  workspaceId: string,
  memberId: string
): Promise<void> {
  const res = await fetch(
    `/api/workspaces/${workspaceId}/members/${memberId}`,
    {
      method: "DELETE",
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to remove member.");
  }
}

