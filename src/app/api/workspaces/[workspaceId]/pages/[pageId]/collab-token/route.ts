import { NextResponse } from "next/server";
import { checkWorkspaceAccess } from "@/lib/auth/workspace-auth";
import { prisma } from "@/lib/prisma";
import { Role } from "@prisma/client";
import {
  createCollabToken,
  COLLAB_TOKEN_EXPIRATION_SECONDS,
} from "@/lib/auth/collab-token";

interface RouteParams {
  params: Promise<{
    workspaceId: string;
    pageId: string;
  }>;
}

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
};

/**
 * POST /api/workspaces/[workspaceId]/pages/[pageId]/collab-token
 * Issues a secure, short-lived JWT token authorizing an OWNER or EDITOR
 * to join the specified page's Yjs collaboration room.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
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

    // 3. Determine database-derived role: only OWNER and EDITOR are permitted
    const effectiveRole: Role = isOwner ? Role.OWNER : (membership?.role as Role);

    if (effectiveRole !== Role.OWNER && effectiveRole !== Role.EDITOR) {
      return NextResponse.json(
        {
          error:
            "Forbidden: Only workspace owners and editors can join real-time collaboration rooms.",
        },
        { status: 403, headers: NO_STORE_HEADERS }
      );
    }

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
