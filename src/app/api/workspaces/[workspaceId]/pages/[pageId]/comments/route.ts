import { NextRequest, NextResponse } from "next/server";
import { checkWorkspaceAccess } from "@/lib/auth/workspace-auth";
import { prisma } from "@/lib/prisma";
import { Role } from "@prisma/client";
import { createCommentSchema } from "@/lib/validations/comment";
import {
  NO_STORE_HEADERS,
  enforceRateLimit,
  readJsonBody,
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
 * GET /api/workspaces/[workspaceId]/pages/[pageId]/comments
 * Lists comments for a document (bounded). Accessible to all authorized workspace members.
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
      request.nextUrl.searchParams.get("limit") || "200",
      10
    );
    const take =
      Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 500) : 200;

    // 3. Retrieve comments sorted by createdAt ascending
    const comments = await prisma.comment.findMany({
      where: { pageId: page.id },
      include: {
        author: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: { createdAt: "asc" },
      take,
    });

    return NextResponse.json({ comments }, { status: 200, headers: NO_STORE_HEADERS });
  } catch (error) {
    logStructured("error", "CommentsAPI", "list_failed", { error });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}

/**
 * POST /api/workspaces/[workspaceId]/pages/[pageId]/comments
 * Creates a new comment. Allowed for OWNER, EDITOR, and COMMENTER. VIEWER receives 403.
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

    // 2. Role Check: VIEWER cannot comment
    if (effectiveRole === Role.VIEWER) {
      return NextResponse.json(
        { error: "Forbidden: Viewers do not have permission to post comments." },
        { status: 403, headers: NO_STORE_HEADERS }
      );
    }

    const rateLimited = enforceRateLimit(request, {
      keyPrefix: "comment_create",
      limit: 60,
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

    // 4. Validate request body safely
    const parsedBody = await readJsonBody(request, 64 * 1024);
    if (!parsedBody.ok) return parsedBody.response;

    const parseResult = createCommentSchema.safeParse(parsedBody.data);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: "Invalid input",
          issues: parseResult.error.flatten().fieldErrors,
        },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    // 5. Create comment, strictly deriving authorId from authenticated session
    const comment = await prisma.comment.create({
      data: {
        pageId: page.id,
        authorId: session.userId,
        body: parseResult.data.body,
        anchor: parseResult.data.anchor ?? undefined,
      },
      include: {
        author: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    return NextResponse.json(
      {
        message: "Comment created successfully",
        comment,
      },
      { status: 201, headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    console.error("[COMMENTS_POST_ERROR]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}

