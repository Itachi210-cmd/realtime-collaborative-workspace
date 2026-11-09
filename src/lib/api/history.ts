export interface VersionAuthor {
  id: string;
  name: string;
  email: string;
}

export interface VersionSummaryData {
  id: string;
  pageId: string;
  createdById: string | null;
  label: string | null;
  description: string | null;
  wordCount: number | null;
  isAutomatic: boolean;
  createdAt: string;
  createdBy: VersionAuthor | null;
}

export interface VersionDetailData extends VersionSummaryData {
  content: unknown | null;
}

export interface RestoreVersionResponse {
  success: boolean;
  message: string;
  restoredVersion: VersionSummaryData;
  recoverySnapshot: {
    id: string;
    pageId: string;
    label: string | null;
    isAutomatic: boolean;
    createdAt: string;
  } | null;
}

/**
 * Fetches the list of saved versions for a page, ordered newest first.
 */
export async function listPageVersions(
  workspaceId: string,
  pageId: string,
  signal?: AbortSignal
): Promise<VersionSummaryData[]> {
  const res = await fetch(
    `/api/workspaces/${workspaceId}/pages/${pageId}/versions`,
    {
      cache: "no-store",
      signal,
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to load version history.");
  }

  const data = await res.json();
  return data.versions || [];
}

/**
 * Fetches an individual version snapshot with full preview content JSON.
 */
export async function getPageVersion(
  workspaceId: string,
  pageId: string,
  versionId: string,
  signal?: AbortSignal
): Promise<VersionDetailData> {
  const res = await fetch(
    `/api/workspaces/${workspaceId}/pages/${pageId}/versions/${versionId}`,
    {
      cache: "no-store",
      signal,
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to load version details.");
  }

  const data = await res.json();
  return data.version;
}

/**
 * Creates a manual version snapshot of the current document state.
 */
export async function createPageVersion(
  workspaceId: string,
  pageId: string,
  payload: { label?: string; description?: string }
): Promise<VersionSummaryData> {
  const res = await fetch(
    `/api/workspaces/${workspaceId}/pages/${pageId}/versions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to create version snapshot.");
  }

  const data = await res.json();
  return data.version;
}

/**
 * Restores a historical version snapshot into the active document.
 */
export async function restorePageVersion(
  workspaceId: string,
  pageId: string,
  versionId: string
): Promise<RestoreVersionResponse> {
  const res = await fetch(
    `/api/workspaces/${workspaceId}/pages/${pageId}/versions/${versionId}/restore`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to restore document version.");
  }

  return await res.json();
}

