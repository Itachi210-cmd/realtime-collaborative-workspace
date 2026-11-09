import { NextResponse } from "next/server";
import { checkWorkspaceAccess } from "@/lib/auth/workspace-auth";
import { prisma } from "@/lib/prisma";
import { Role } from "@prisma/client";
import {
  getVersionSnapshot,
  restoreVersionSnapshot,
} from "@/server/version-snapshot-service.mjs";

interface RouteParams {
  params: Promise<{
    workspaceId: string;
    pageId: string;
    versionId: string;
  }>;
}

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
};

/**
 * POST /api/workspaces/[workspaceId]/pages/[pageId]/versions/[versionId]/restore
 * Restores a historical document version into the active document.
 * Only OWNER and EDITOR roles can restore; COMMENTER and VIEWER receive 403 Forbidden.
 * Strictly verifies workspace membership, page boundaries, and snapshot ownership.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { workspaceId, pageId, versionId } = await params;

    // 1. Authenticate user & verify workspace membership
    const authCheck = await checkWorkspaceAccess(workspaceId);
    if (!authCheck.success) {
      return NextResponse.json(
        { error: authCheck.error },
        { status: authCheck.status, headers: NO_STORE_HEADERS }
      );
    }

    const { session, isOwner, membership } = authCheck.data;
    const effectiveRole: Role = isOwner ? Role.OWNER : (membership?.role as Role);

    // 2. Role Check: Only OWNER and EDITOR can restore versions
    if (effectiveRole !== Role.OWNER && effectiveRole !== Role.EDITOR) {
      return NextResponse.json(
        { error: "Forbidden: Only owners and editors can restore document versions." },
        { status: 403, headers: NO_STORE_HEADERS }
      );
    }

    // 3. Verify page exists and belongs to this workspace (prevent IDOR)
    const page = await prisma.page.findUnique({
      where: { id: pageId },
      select: { id: true, workspaceId: true },
    });

    if (!page || page.workspaceId !== workspaceId) {
      return NextResponse.json(
        { error: "Document not found in this workspace." },
        { status: 404, headers: NO_STORE_HEADERS }
      );
    }

    // 4. Verify target snapshot exists and belongs to this page (prevent cross-page restore)
    const targetSnapshot = await getVersionSnapshot(pageId, versionId);
    if (!targetSnapshot) {
      return NextResponse.json(
        { error: "Version snapshot not found for this document." },
        { status: 404, headers: NO_STORE_HEADERS }
      );
    }

    // 5. Restore version via dedicated snapshot service (handles RPC, locks, recovery snapshot, and persistence)
    const restoreResult = await restoreVersionSnapshot(pageId, versionId, {
      userId: session.userId,
    });

    return NextResponse.json(
      {
        success: true,
        message: "Document version restored successfully.",
        restoredVersion: {
          id: restoreResult.restoredVersion.id,
          pageId: restoreResult.restoredVersion.pageId,
          label: restoreResult.restoredVersion.label,
          description: restoreResult.restoredVersion.description,
          wordCount: restoreResult.restoredVersion.wordCount,
          isAutomatic: restoreResult.restoredVersion.isAutomatic,
          createdAt: restoreResult.restoredVersion.createdAt,
          createdBy: restoreResult.restoredVersion.createdBy,
        },
        recoverySnapshot: restoreResult.recoverySnapshot
          ? {
              id: restoreResult.recoverySnapshot.id,
              pageId: restoreResult.recoverySnapshot.pageId,
              label: restoreResult.recoverySnapshot.label,
              isAutomatic: restoreResult.recoverySnapshot.isAutomatic,
              createdAt: restoreResult.recoverySnapshot.createdAt,
            }
          : null,
      },
      { status: 200, headers: NO_STORE_HEADERS }
    );
  } catch (error: unknown) {
    console.error("[VERSION_RESTORE_POST_ERROR]", error);
    const errObj = error as { statusCode?: number; status?: number; message?: string };
    const status = errObj?.statusCode || errObj?.status || 500;
    const message = errObj?.message || "Failed to restore document version.";
    return NextResponse.json(
      { error: message },
      { status: status >= 400 && status < 600 ? status : 500, headers: NO_STORE_HEADERS }
    );
  }
}
