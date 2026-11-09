import { NextResponse } from "next/server";
import { checkWorkspaceAccess } from "@/lib/auth/workspace-auth";
import { prisma } from "@/lib/prisma";
import { getVersionSnapshot } from "@/server/version-snapshot-service.mjs";

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
 * GET /api/workspaces/[workspaceId]/pages/[pageId]/versions/[versionId]
 * Retrieves a single version snapshot with full TipTap content JSON preview.
 * Accessible to all authorized workspace members. Strictly verifies page and workspace boundaries.
 */
export async function GET(request: Request, { params }: RouteParams) {
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

    // 2. Verify page exists and belongs to this workspace (prevent IDOR)
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

    // 3. Retrieve snapshot via dedicated service (verifies pageId matches)
    const snapshot = await getVersionSnapshot(pageId, versionId);

    if (!snapshot) {
      return NextResponse.json(
        { error: "Version snapshot not found." },
        { status: 404, headers: NO_STORE_HEADERS }
      );
    }

    // Exclude raw binary yjsState from preview payload
    const versionData = {
      id: snapshot.id,
      pageId: snapshot.pageId,
      createdById: snapshot.createdById,
      label: snapshot.label,
      description: snapshot.description,
      content: snapshot.content,
      wordCount: snapshot.wordCount,
      isAutomatic: snapshot.isAutomatic,
      createdAt: snapshot.createdAt,
      createdBy: snapshot.createdBy,
    };

    return NextResponse.json(
      { version: versionData },
      { status: 200, headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    console.error("[VERSION_GET_SINGLE_ERROR]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
