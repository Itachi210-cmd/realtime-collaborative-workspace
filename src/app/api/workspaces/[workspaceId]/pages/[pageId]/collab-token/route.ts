import { NextRequest, NextResponse } from "next/server";
import { checkWorkspaceAccess } from "@/lib/auth/workspace-auth";
import { prisma } from "@/lib/prisma";
import { Role } from "@prisma/client";
import {
  createCollabToken,
  COLLAB_TOKEN_EXPIRATION_SECONDS,
} from "@/lib/auth/collab-token";
import {
  NO_STORE_HEADERS,
  enforceRateLimit,
  verifySameOriginCsrf,
} from "@/lib/security/api-guard";

interface RouteParams {
  params: Promise<{
    workspaceId: string;
    pageId: string;
  }>;
}

/**
 * POST /api/workspaces/[workspaceId]/pages/[pageId]/collab-token
 * Issues a short-lived JWT token authorizing an authorized workspace member
 * to join the specified page's Yjs collaboration room.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const csrfError = verifySameOriginCsrf(request);
    if (csrfError) return csrfError;

    const { workspaceId, pageId } = await params;

    // 1. Authenticate user through existing session & verify workspace access
    const authCheck = await checkWorkspaceAccess(workspaceId);
    if (!authCheck.success) {
      return NextResponse.json(
        { error: authCheck.error },
        { status: authCheck.status, headers: NO_STORE_HEADERS }
      );
    }

    const { session, isOwner, membership } = authCheck.data;

    const rateLimited = enforceRateLimit(request, {
      keyPrefix: "collab_token",
      limit: 60,
      windowMs: 60_000,
      identifier: session.userId,
    });
    if (rateLimited) return rateLimited;

    // 2. Verify page exists and belongs to the requested workspace
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

    // 3. Determine database-derived role: all four workspace roles (OWNER, EDITOR, COMMENTER, VIEWER) are permitted
    const effectiveRole: Role = isOwner ? Role.OWNER : (membership?.role as Role);

    // 4. Mint short-lived JWT token (never trusting client-supplied payload)
    const token = await createCollabToken({
      userId: session.userId,
      userName: session.name,
      pageId: page.id,
      workspaceId,
      role: effectiveRole,
    });

    return NextResponse.json(
      {
        token,
        expiresIn: COLLAB_TOKEN_EXPIRATION_SECONDS,
        role: effectiveRole,
      },
      {
        status: 200,
        headers: NO_STORE_HEADERS,
      }
    );
  } catch {
    // Never log tokens or internal database details
    console.error("[COLLAB_TOKEN_ERROR] An error occurred while generating collaboration token");
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
