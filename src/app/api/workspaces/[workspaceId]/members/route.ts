import { NextResponse } from "next/server";
import { checkWorkspaceAccess } from "@/lib/auth/workspace-auth";
import { prisma } from "@/lib/prisma";
import { addMemberSchema } from "@/lib/validations/member";

interface RouteParams {
  params: Promise<{
    workspaceId: string;
  }>;
}

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
};

/**
 * GET /api/workspaces/[workspaceId]/members
 * Lists all members of the workspace. Available to all authenticated members.
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { workspaceId } = await params;

    const authCheck = await checkWorkspaceAccess(workspaceId);
    if (!authCheck.success) {
      return NextResponse.json(
        { error: authCheck.error },
        { status: authCheck.status, headers: NO_STORE_HEADERS }
      );
    }

    const members = await prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: { joinedAt: "asc" },
    });

    return NextResponse.json(
      {
        members: members.map((m) => ({
          id: m.id,
          userId: m.userId,
          name: m.user.name,
          email: m.user.email,
          role: m.role,
          joinedAt: m.joinedAt,
        })),
      },
      { status: 200, headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    console.error("[MEMBERS_GET_ERROR]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}

/**
 * POST /api/workspaces/[workspaceId]/members
 * Invites / adds an existing registered user to the workspace. Restricted to OWNER only.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { workspaceId } = await params;

    // 1. Authorize: strictly restricted to workspace OWNER
    const authCheck = await checkWorkspaceAccess(workspaceId, { requireOwner: true });
    if (!authCheck.success) {
      return NextResponse.json(
        { error: authCheck.error },
        { status: authCheck.status, headers: NO_STORE_HEADERS }
      );
    }

    const { workspace } = authCheck.data;

    // 2. Validate payload
    const body = await request.json();
    const parseResult = addMemberSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: "Invalid input",
          issues: parseResult.error.flatten().fieldErrors,
        },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    const { email, role } = parseResult.data;

    // 3. Find existing registered user by email
    const targetUser = await prisma.user.findUnique({
      where: { email },
      select: { id: true, name: true, email: true },
    });

    if (!targetUser) {
      return NextResponse.json(
        { error: "User not found with this email address." },
        { status: 404, headers: NO_STORE_HEADERS }
      );
    }

    // 4. Prevent adding workspace owner as a member
    if (targetUser.id === workspace.ownerId) {
      return NextResponse.json(
        { error: "The workspace owner cannot be added as a member." },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    // 5. Prevent duplicate membership
    const existingMembership = await prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId: targetUser.id,
        },
      },
    });

    if (existingMembership) {
      return NextResponse.json(
        { error: "User is already a member of this workspace." },
        { status: 409, headers: NO_STORE_HEADERS }
      );
    }

    // 6. Create membership
    const member = await prisma.workspaceMember.create({
      data: {
        workspaceId,
        userId: targetUser.id,
        role,
      },
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    return NextResponse.json(
      {
        message: "Member added successfully",
        member: {
          id: member.id,
          userId: member.userId,
          name: member.user.name,
          email: member.user.email,
          role: member.role,
          joinedAt: member.joinedAt,
        },
      },
      { status: 201, headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    console.error("[MEMBERS_POST_ERROR]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}

