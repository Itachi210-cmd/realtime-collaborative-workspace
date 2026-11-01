import { NextResponse } from "next/server";
import { checkWorkspaceAccess } from "@/lib/auth/workspace-auth";
import { updateWorkspaceSchema } from "@/lib/validations/workspace";
import { prisma } from "@/lib/prisma";

interface RouteParams {
  params: Promise<{
    workspaceId: string;
  }>;
}

/**
 * GET /api/workspaces/[workspaceId]
 * Retrieves workspace details, members, and page statistics for authorized members.
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { workspaceId } = await params;
    const authCheck = await checkWorkspaceAccess(workspaceId);
    if (!authCheck.success) {
      return NextResponse.json(
        { error: authCheck.error },
        { status: authCheck.status }
      );
    }

    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      include: {
        owner: {
          select: { id: true, name: true, email: true },
        },
        members: {
          include: {
            user: {
              select: { id: true, name: true, email: true },
            },
          },
          orderBy: { joinedAt: "asc" },
        },
        _count: {
          select: { pages: true },
        },
      },
    });

    if (!workspace) {
      return NextResponse.json(
        { error: "Workspace not found" },
        { status: 404 }
      );
    }

    const { session, isOwner } = authCheck.data;
    const currentMember = workspace.members.find(
      (m) => m.userId === session.userId
    );

    return NextResponse.json(
      {
        workspace: {
          id: workspace.id,
          name: workspace.name,
          ownerId: workspace.ownerId,
          owner: workspace.owner,
          isOwner,
          userRole: isOwner ? "OWNER" : currentMember?.role || "VIEWER",
          members: workspace.members.map((m) => ({
            id: m.id,
            userId: m.userId,
            name: m.user.name,
            email: m.user.email,
            role: m.role,
            joinedAt: m.joinedAt,
          })),
          pagesCount: workspace._count.pages,
          createdAt: workspace.createdAt,
          updatedAt: workspace.updatedAt,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[WORKSPACE_GET_ERROR]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/workspaces/[workspaceId]
 * Renames a workspace. Strictly restricted to the workspace owner.
 */
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { workspaceId } = await params;
    const authCheck = await checkWorkspaceAccess(workspaceId, {
      requireOwner: true,
    });
    if (!authCheck.success) {
      return NextResponse.json(
        { error: authCheck.error },
        { status: authCheck.status }
      );
    }

    const body = await request.json();
    const parseResult = updateWorkspaceSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: "Invalid input",
          issues: parseResult.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const updatedWorkspace = await prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        name: parseResult.data.name,
      },
    });

    return NextResponse.json(
      {
        message: "Workspace updated successfully",
        workspace: updatedWorkspace,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[WORKSPACE_PATCH_ERROR]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/workspaces/[workspaceId]
 * Deletes a workspace and all its members and pages. Strictly restricted to the workspace owner.
 */
export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    const { workspaceId } = await params;
    const authCheck = await checkWorkspaceAccess(workspaceId, {
      requireOwner: true,
    });
    if (!authCheck.success) {
      return NextResponse.json(
        { error: authCheck.error },
        { status: authCheck.status }
      );
    }

    await prisma.workspace.delete({
      where: { id: workspaceId },
    });

    return NextResponse.json(
      { message: "Workspace deleted successfully" },
      { status: 200 }
    );
  } catch (error) {
    console.error("[WORKSPACE_DELETE_ERROR]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

