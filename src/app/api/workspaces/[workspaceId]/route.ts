import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { checkWorkspaceAccess } from "@/lib/auth/workspace-auth";
import { updateWorkspaceSchema } from "@/lib/validations/workspace";
import { prisma } from "@/lib/prisma";
import {
  NO_STORE_HEADERS,
  readJsonBody,
  verifySameOriginCsrf,
} from "@/lib/security/api-guard";
import { logStructured } from "@/lib/logger.mjs";

interface RouteParams {
  params: Promise<{
    workspaceId: string;
  }>;
}

/**
 * GET /api/workspaces/[workspaceId]
 * Retrieves workspace details, members, and page statistics in a single database query.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { workspaceId } = await params;
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: NO_STORE_HEADERS }
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
          take: 250,
        },
        _count: {
          select: { pages: true },
        },
      },
    });

    if (!workspace) {
      return NextResponse.json(
        { error: "Workspace not found" },
        { status: 404, headers: NO_STORE_HEADERS }
      );
    }

    const isOwner = workspace.ownerId === session.userId;
    const currentMember = workspace.members.find(
      (m) => m.userId === session.userId
    );

    if (!isOwner && !currentMember) {
      return NextResponse.json(
        { error: "Forbidden: You are not a member of this workspace" },
        { status: 403, headers: NO_STORE_HEADERS }
      );
    }

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
      { status: 200, headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    logStructured("error", "WorkspaceAPI", "get_failed", { error });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}

/**
 * PATCH /api/workspaces/[workspaceId]
 * Renames a workspace. Strictly restricted to the workspace owner.
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const csrfError = verifySameOriginCsrf(request);
    if (csrfError) return csrfError;

    const { workspaceId } = await params;
    const authCheck = await checkWorkspaceAccess(workspaceId, {
      requireOwner: true,
    });
    if (!authCheck.success) {
      return NextResponse.json(
        { error: authCheck.error },
        { status: authCheck.status, headers: NO_STORE_HEADERS }
      );
    }

    const parsedBody = await readJsonBody(request, 16 * 1024);
    if (!parsedBody.ok) return parsedBody.response;

    const parseResult = updateWorkspaceSchema.safeParse(parsedBody.data);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: "Invalid input",
          issues: parseResult.error.flatten().fieldErrors,
        },
        { status: 400, headers: NO_STORE_HEADERS }
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
      { status: 200, headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    logStructured("error", "WorkspaceAPI", "patch_failed", { error });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}

/**
 * DELETE /api/workspaces/[workspaceId]
 * Deletes a workspace and all its members and pages. Strictly restricted to the workspace owner.
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const csrfError = verifySameOriginCsrf(request);
    if (csrfError) return csrfError;

    const { workspaceId } = await params;
    const authCheck = await checkWorkspaceAccess(workspaceId, {
      requireOwner: true,
    });
    if (!authCheck.success) {
      return NextResponse.json(
        { error: authCheck.error },
        { status: authCheck.status, headers: NO_STORE_HEADERS }
      );
    }

    await prisma.workspace.delete({
      where: { id: workspaceId },
    });

    return NextResponse.json(
      { message: "Workspace deleted successfully" },
      { status: 200, headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    logStructured("error", "WorkspaceAPI", "delete_failed", { error });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}

