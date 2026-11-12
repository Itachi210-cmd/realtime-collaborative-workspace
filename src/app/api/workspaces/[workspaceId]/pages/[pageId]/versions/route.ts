import { NextRequest, NextResponse } from "next/server";
import { checkWorkspaceAccess } from "@/lib/auth/workspace-auth";
import { prisma } from "@/lib/prisma";
import { Role } from "@prisma/client";
import { createVersionSnapshotSchema } from "@/lib/validations/snapshot";
import {
  createVersionSnapshot,
  listVersionSnapshots,
} from "@/server/version-snapshot-service.mjs";
import {
  NO_STORE_HEADERS,
  enforceRateLimit,
  verifySameOriginCsrf,
} from "@/lib/security/api-guard";
import { logStructured } from "@/lib/logger.mjs";

interface RouteParams {
  params: Promise<{
    workspaceId: string;
    pageId: string;
  }>;
}

/**
 * GET /api/workspaces/[workspaceId]/pages/[pageId]/versions
 * Lists version snapshots for a page in reverse chronological order (newest first).
 * Excludes heavy binary CRDT payload. Accessible to all authorized workspace members.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { workspaceId, pageId } = await params;

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

    const rawLimit = Number.parseInt(
      request.nextUrl.searchParams.get("limit") || "50",
      10
    );
    const limit =
      Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 50;

    // 3. Retrieve snapshots via dedicated snapshot service
    const versions = await listVersionSnapshots(pageId, { limit });

    return NextResponse.json({ versions }, { status: 200, headers: NO_STORE_HEADERS });
  } catch (error) {
    logStructured("error", "VersionsAPI", "list_failed", { error });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}

/**
 * POST /api/workspaces/[workspaceId]/pages/[pageId]/versions
 * Creates a manual version snapshot of the current document state.
 * Only OWNER and EDITOR roles can create snapshots; COMMENTER and VIEWER receive 403 Forbidden.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const csrfError = verifySameOriginCsrf(request);
    if (csrfError) return csrfError;

    const { workspaceId, pageId } = await params;

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

    // 2. Role Check: Only OWNER and EDITOR can create snapshots
    if (effectiveRole !== Role.OWNER && effectiveRole !== Role.EDITOR) {
      return NextResponse.json(
        { error: "Forbidden: Only owners and editors can create version snapshots." },
        { status: 403, headers: NO_STORE_HEADERS }
      );
    }

    const rateLimited = enforceRateLimit(request, {
      keyPrefix: "version_create",
      limit: 30,
      windowMs: 60_000,
      identifier: session.userId,
    });
    if (rateLimited) return rateLimited;

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

    // 4. Validate request body
    let body: unknown = {};
    try {
      const text = await request.text();
      if (text.trim().length > 0) {
        body = JSON.parse(text);
      }
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON in request body." },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    const parseResult = createVersionSnapshotSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: "Validation failed",
          details: parseResult.error.flatten().fieldErrors,
        },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    const { label, description } = parseResult.data;

    // 5. Create snapshot through service
    const snapshot = await createVersionSnapshot(pageId, {
      userId: session.userId,
      label: label ?? undefined,
      description: description ?? undefined,
      isAutomatic: false,
    });

    // Exclude raw binary yjsState from HTTP JSON response
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
      {
        message: "Version snapshot created successfully",
        version: versionData,
      },
      { status: 201, headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    console.error("[VERSIONS_POST_ERROR]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
