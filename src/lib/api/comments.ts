export interface CommentAuthor {
  id: string;
  name: string;
  email: string;
}

export interface CommentItemData {
  id: string;
  pageId: string;
  authorId: string;
  body: string;
  anchor?: Record<string, unknown> | null;
  resolvedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  author: CommentAuthor;
}

export async function getPageComments(
  workspaceId: string,
  pageId: string,
  signal?: AbortSignal
): Promise<CommentItemData[]> {
  const res = await fetch(
    `/api/workspaces/${workspaceId}/pages/${pageId}/comments`,
    {
      cache: "no-store",
      signal,
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to load comments.");
  }

  const data = await res.json();
  return data.comments || [];
}

export async function createComment(
  workspaceId: string,
  pageId: string,
  body: string,
  anchor?: Record<string, unknown> | null
): Promise<CommentItemData> {
  const res = await fetch(
    `/api/workspaces/${workspaceId}/pages/${pageId}/comments`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body, anchor }),
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to post comment.");
  }

  const data = await res.json();
  return data.comment;
}

export async function updateComment(
  workspaceId: string,
  pageId: string,
  commentId: string,
  updates: { body?: string; resolved?: boolean }
): Promise<CommentItemData> {
  const res = await fetch(
    `/api/workspaces/${workspaceId}/pages/${pageId}/comments/${commentId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to update comment.");
  }

  const data = await res.json();
  return data.comment;
}

export async function deleteComment(
  workspaceId: string,
  pageId: string,
  commentId: string
): Promise<void> {
  const res = await fetch(
    `/api/workspaces/${workspaceId}/pages/${pageId}/comments/${commentId}`,
    {
      method: "DELETE",
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to delete comment.");
  }
}

