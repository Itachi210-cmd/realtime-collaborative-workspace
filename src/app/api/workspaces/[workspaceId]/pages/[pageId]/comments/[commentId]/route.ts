import { NextResponse } from "next/server";
import { checkWorkspaceAccess } from "@/lib/auth/workspace-auth";
import { prisma } from "@/lib/prisma";
import { Role } from "@prisma/client";
import { updateCommentSchema } from "@/lib/validations/comment";

interface RouteParams {
  params: Promise<{
    workspaceId: string;
    pageId: string;
    commentId: string;
  }>;
}

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
};

/**
 * PATCH /api/workspaces/[workspaceId]/pages/[pageId]/comments/[commentId]
 * Updates comment body or resolved status.
 * - Author can edit comment text.
 * - Author, EDITOR, or OWNER can resolve/unresolve.
 * - COMMENTER cannot resolve another user's comment.
 * - VIEWER cannot modify comments.
 */
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { workspaceId, pageId, commentId } = await params;

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

    // 2. Viewers have strictly read-only access
    if (effectiveRole === Role.VIEWER) {
      return NextResponse.json(
        { error: "Forbidden: Viewers do not have permission to modify comments." },
        { status: 403, headers: NO_STORE_HEADERS }
      );
    }

    // 3. Verify comment exists, belongs to page, and page belongs to workspace (IDOR prevention)
    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
      include: {
        page: {
          select: { id: true, workspaceId: true },
        },
      },
    });

    if (
      !comment ||
      comment.pageId !== pageId ||
      comment.page.workspaceId !== workspaceId
    ) {
      return NextResponse.json(
        { error: "Comment not found in this workspace document." },
        { status: 404, headers: NO_STORE_HEADERS }
      );
    }

    // 4. Validate input
    const body = await request.json();
    const parseResult = updateCommentSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: "Invalid input",
          issues: parseResult.error.flatten().fieldErrors,
        },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    const isAuthor = comment.authorId === session.userId;
    const { body: updatedBodyText, resolved } = parseResult.data;

    // 5. Body text update: ONLY author can edit text
    if (updatedBodyText !== undefined && !isAuthor) {
      return NextResponse.json(
        { error: "Forbidden: You can only edit the text of your own comments." },
        { status: 403, headers: NO_STORE_HEADERS }
      );
    }

    // 6. Resolved status update: Author, EDITOR, or OWNER permitted.
    // COMMENTER cannot resolve other member's comments.
    if (resolved !== undefined) {
      const canResolve =
        isAuthor || effectiveRole === Role.OWNER || effectiveRole === Role.EDITOR;
      if (!canResolve) {
        return NextResponse.json(
          {
            error:
              "Forbidden: Commenters do not have permission to resolve other members' comments.",
          },
          { status: 403, headers: NO_STORE_HEADERS }
        );
      }
    }

    // 7. Perform update
    const updateData: { body?: string; resolvedAt?: Date | null } = {};
    if (updatedBodyText !== undefined) {
      updateData.body = updatedBodyText;
    }
    if (resolved !== undefined) {
      updateData.resolvedAt = resolved ? new Date() : null;
    }

    const updatedComment = await prisma.comment.update({
      where: { id: commentId },
      data: updateData,
      include: {
        author: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    return NextResponse.json(
      {
        message: "Comment updated successfully",
        comment: updatedComment,
      },
      { status: 200, headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    console.error("[COMMENT_PATCH_ERROR]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}

/**
 * DELETE /api/workspaces/[workspaceId]/pages/[pageId]/comments/[commentId]
 * Deletes a comment. Allowed for comment author or workspace OWNER.
 */
export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    const { workspaceId, pageId, commentId } = await params;

    // 1. Authenticate user & verify workspace membership
    const authCheck = await checkWorkspaceAccess(workspaceId);
    if (!authCheck.success) {
      return NextResponse.json(
        { error: authCheck.error },
        { status: authCheck.status, headers: NO_STORE_HEADERS }
      );
    }

    const { session, isOwner } = authCheck.data;

    // 2. Verify comment exists, belongs to page, and page belongs to workspace (IDOR prevention)
    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
      include: {
        page: {
          select: { id: true, workspaceId: true },
        },
      },
    });

    if (
      !comment ||
      comment.pageId !== pageId ||
      comment.page.workspaceId !== workspaceId
    ) {
      return NextResponse.json(
        { error: "Comment not found in this workspace document." },
        { status: 404, headers: NO_STORE_HEADERS }
      );
    }

    // 3. Authorization: Only comment author or workspace OWNER
    const isAuthor = comment.authorId === session.userId;
    if (!isAuthor && !isOwner) {
      return NextResponse.json(
        {
          error:
            "Forbidden: Only the comment author or workspace owner can delete this comment.",
        },
        { status: 403, headers: NO_STORE_HEADERS }
      );
    }

    // 4. Delete comment
    await prisma.comment.delete({
      where: { id: commentId },
    });

    return NextResponse.json(
      { message: "Comment deleted successfully" },
      { status: 200, headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    console.error("[COMMENT_DELETE_ERROR]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}

