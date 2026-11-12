import { NextRequest, NextResponse } from "next/server";
import { checkWorkspaceAccess } from "@/lib/auth/workspace-auth";
import { prisma } from "@/lib/prisma";
import { addMemberSchema } from "@/lib/validations/member";
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
  }>;
}

/**
 * GET /api/workspaces/[workspaceId]/members
 * Lists members of the workspace (bounded). Available to all authenticated members.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { workspaceId } = await params;

    const authCheck = await checkWorkspaceAccess(workspaceId);
    if (!authCheck.success) {
      return NextResponse.json(
        { error: authCheck.error },
        { status: authCheck.status, headers: NO_STORE_HEADERS }
      );
    }

    const rawLimit = Number.parseInt(
      request.nextUrl.searchParams.get("limit") || "200",
      10
    );
    const take =
      Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 500) : 200;

    const members = await prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: { joinedAt: "asc" },
      take,
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
    logStructured("error", "MembersAPI", "list_failed", { error });
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
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const csrfError = verifySameOriginCsrf(request);
    if (csrfError) return csrfError;

    const { workspaceId } = await params;

    // 1. Authorize: strictly restricted to workspace OWNER
    const authCheck = await checkWorkspaceAccess(workspaceId, { requireOwner: true });
    if (!authCheck.success) {
      return NextResponse.json(
        { error: authCheck.error },
        { status: authCheck.status, headers: NO_STORE_HEADERS }
      );
    }

    const { workspace, session } = authCheck.data;

    const rateLimited = enforceRateLimit(request, {
      keyPrefix: "member_invite",
      limit: 30,
      windowMs: 60_000,
      identifier: session.userId,
    });
    if (rateLimited) return rateLimited;

    // 2. Validate payload
    const parsedBody = await readJsonBody(request, 16 * 1024);
    if (!parsedBody.ok) return parsedBody.response;

    const parseResult = addMemberSchema.safeParse(parsedBody.data);
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
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "P2002"
    ) {
      return NextResponse.json(
        { error: "User is already a member of this workspace." },
        { status: 409, headers: NO_STORE_HEADERS }
      );
    }
    logStructured("error", "MembersAPI", "create_failed", { error });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}

