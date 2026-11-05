import { NextResponse } from "next/server";
import { checkWorkspaceAccess } from "@/lib/auth/workspace-auth";
import { prisma } from "@/lib/prisma";
import { updateMemberRoleSchema } from "@/lib/validations/member";

interface RouteParams {
  params: Promise<{
    workspaceId: string;
    memberId: string;
  }>;
}

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
};

/**
 * PATCH /api/workspaces/[workspaceId]/members/[memberId]
 * Updates a workspace member's role (EDITOR, COMMENTER, VIEWER). Restricted to OWNER only.
 */
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { workspaceId, memberId } = await params;

    // 1. Authorize: restricted to workspace OWNER
    const authCheck = await checkWorkspaceAccess(workspaceId, { requireOwner: true });
    if (!authCheck.success) {
      return NextResponse.json(
        { error: authCheck.error },
        { status: authCheck.status, headers: NO_STORE_HEADERS }
      );
    }

    const { workspace } = authCheck.data;

    // 2. Validate input role
    const body = await request.json();
    const parseResult = updateMemberRoleSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: "Invalid input",
          issues: parseResult.error.flatten().fieldErrors,
        },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    const { role } = parseResult.data;

    // 3. Find member and verify workspace relation (IDOR prevention)
    const existingMember = await prisma.workspaceMember.findUnique({
      where: { id: memberId },
    });

    if (!existingMember || existingMember.workspaceId !== workspaceId) {
      return NextResponse.json(
        { error: "Member not found in this workspace." },
        { status: 404, headers: NO_STORE_HEADERS }
      );
    }

    // 4. Protect workspace owner from accidental demotion
    if (existingMember.userId === workspace.ownerId) {
      return NextResponse.json(
        { error: "Workspace owner role cannot be altered." },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    // 5. Update member role
    const updatedMember = await prisma.workspaceMember.update({
      where: { id: memberId },
      data: { role },
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    return NextResponse.json(
      {
        message: "Member role updated successfully",
        member: {
          id: updatedMember.id,
          userId: updatedMember.userId,
          name: updatedMember.user.name,
          email: updatedMember.user.email,
          role: updatedMember.role,
          joinedAt: updatedMember.joinedAt,
        },
      },
      { status: 200, headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    console.error("[MEMBER_PATCH_ERROR]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}

/**
 * DELETE /api/workspaces/[workspaceId]/members/[memberId]
 * Removes a member from the workspace. Restricted to OWNER only.
 */
export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    const { workspaceId, memberId } = await params;

    // 1. Authorize: restricted to workspace OWNER
    const authCheck = await checkWorkspaceAccess(workspaceId, { requireOwner: true });
    if (!authCheck.success) {
      return NextResponse.json(
        { error: authCheck.error },
        { status: authCheck.status, headers: NO_STORE_HEADERS }
      );
    }

    const { workspace } = authCheck.data;

    // 2. Find member and verify workspace relation (IDOR prevention)
    const existingMember = await prisma.workspaceMember.findUnique({
      where: { id: memberId },
    });

    if (!existingMember || existingMember.workspaceId !== workspaceId) {
      return NextResponse.json(
        { error: "Member not found in this workspace." },
        { status: 404, headers: NO_STORE_HEADERS }
      );
    }

    // 3. Protect workspace owner from removal
    if (existingMember.userId === workspace.ownerId) {
      return NextResponse.json(
        { error: "Cannot remove the workspace owner from the workspace." },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    // 4. Remove member
    await prisma.workspaceMember.delete({
      where: { id: memberId },
    });

    return NextResponse.json(
      { message: "Member removed successfully" },
      { status: 200, headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    console.error("[MEMBER_DELETE_ERROR]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}

