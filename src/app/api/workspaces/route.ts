import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { createWorkspaceSchema } from "@/lib/validations/workspace";
import { Role } from "@prisma/client";
import {
  NO_STORE_HEADERS,
  enforceRateLimit,
  readJsonBody,
  verifySameOriginCsrf,
} from "@/lib/security/api-guard";
import { logStructured } from "@/lib/logger.mjs";

/**
 * GET /api/workspaces
 * Lists workspaces that the logged-in user owns or is a member of.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: NO_STORE_HEADERS }
      );
    }

    const rawLimit = Number.parseInt(
      request.nextUrl.searchParams.get("limit") || "100",
      10
    );
    const take =
      Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : 100;

    const workspaces = await prisma.workspace.findMany({
      where: {
        OR: [
          { ownerId: session.userId },
          { members: { some: { userId: session.userId } } },
        ],
      },
      include: {
        owner: {
          select: { id: true, name: true, email: true },
        },
        members: {
          where: { userId: session.userId },
          select: { role: true },
        },
        _count: {
          select: {
            members: true,
            pages: true,
          },
        },
      },
      orderBy: { updatedAt: "desc" },
      take,
    });

    const formatted = workspaces.map((ws) => {
      const isOwner = ws.ownerId === session.userId;
      const userRole: Role = isOwner
        ? Role.OWNER
        : ws.members[0]?.role || Role.VIEWER;

      return {
        id: ws.id,
        name: ws.name,
        ownerId: ws.ownerId,
        owner: ws.owner,
        role: userRole,
        isOwner,
        membersCount: ws._count.members,
        pagesCount: ws._count.pages,
        createdAt: ws.createdAt,
        updatedAt: ws.updatedAt,
      };
    });

    return NextResponse.json(
      { workspaces: formatted },
      { status: 200, headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    logStructured("error", "WorkspacesAPI", "list_failed", { error });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}

/**
 * POST /api/workspaces
 * Creates a new workspace and automatically adds the creator as OWNER member in a transaction.
 */
export async function POST(request: NextRequest) {
  try {
    const csrfError = verifySameOriginCsrf(request);
    if (csrfError) return csrfError;

    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: NO_STORE_HEADERS }
      );
    }

    const rateLimited = enforceRateLimit(request, {
      keyPrefix: "workspace_create",
      limit: 20,
      windowMs: 60_000,
      identifier: session.userId,
    });
    if (rateLimited) return rateLimited;

    const parsedBody = await readJsonBody(request, 16 * 1024);
    if (!parsedBody.ok) return parsedBody.response;

    const parseResult = createWorkspaceSchema.safeParse(parsedBody.data);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: "Invalid input",
          issues: parseResult.error.flatten().fieldErrors,
        },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    const { name } = parseResult.data;

    // Atomically create the workspace and the creator's OWNER membership
    const result = await prisma.$transaction(async (tx) => {
      const workspace = await tx.workspace.create({
        data: {
          name,
          ownerId: session.userId,
        },
      });

      const member = await tx.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: session.userId,
          role: Role.OWNER,
        },
      });

      return { workspace, member };
    });

    return NextResponse.json(
      {
        message: "Workspace created successfully",
        workspace: {
          id: result.workspace.id,
          name: result.workspace.name,
          ownerId: result.workspace.ownerId,
          role: Role.OWNER,
          isOwner: true,
          membersCount: 1,
          pagesCount: 0,
          createdAt: result.workspace.createdAt,
          updatedAt: result.workspace.updatedAt,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[WORKSPACE_CREATE_ERROR]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

