import { NextResponse } from "next/server";
import { checkWorkspaceAccess } from "@/lib/auth/workspace-auth";
import { createPageSchema, DEFAULT_PAGE_CONTENT } from "@/lib/validations/page";
import { prisma } from "@/lib/prisma";
import { Role } from "@prisma/client";

interface RouteParams {
  params: Promise<{
    workspaceId: string;
  }>;
}

/**
 * GET /api/workspaces/[workspaceId]/pages
 * Lists all pages in the authorized workspace with hierarchical child relations.
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

    const pages = await prisma.page.findMany({
      where: { workspaceId },
      include: {
        createdBy: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({ pages }, { status: 200 });
  } catch (error) {
    console.error("[PAGES_GET_ERROR]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/workspaces/[workspaceId]/pages
 * Creates a new page inside the workspace.
 * Validates workspace membership, ensures parentPageId belongs to the same workspace,
 * and sets createdById from the authenticated session.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { workspaceId } = await params;
    const authCheck = await checkWorkspaceAccess(workspaceId);
    if (!authCheck.success) {
      return NextResponse.json(
        { error: authCheck.error },
        { status: authCheck.status }
      );
    }

    const { isOwner, membership, session } = authCheck.data;
    const effectiveRole: Role = isOwner ? Role.OWNER : (membership?.role as Role);

    if (effectiveRole !== Role.OWNER && effectiveRole !== Role.EDITOR) {
      return NextResponse.json(
        {
          error:
            "Forbidden: You do not have permission to create pages in this workspace.",
        },
        { status: 403 }
      );
    }

    const body = await request.json();
    const parseResult = createPageSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: "Invalid input",
          issues: parseResult.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const { title, parentPageId } = parseResult.data;

    // Validate parentPageId if provided:
    // It MUST belong to the SAME workspace to prevent cross-workspace references!
    if (parentPageId) {
      const parentPage = await prisma.page.findUnique({
        where: { id: parentPageId },
        select: { id: true, workspaceId: true },
      });

      if (!parentPage || parentPage.workspaceId !== workspaceId) {
        return NextResponse.json(
          {
            error:
              "Invalid parent page: The parent document does not exist in this workspace.",
          },
          { status: 400 }
        );
      }
    }

    const page = await prisma.page.create({
      data: {
        title,
        workspaceId,
        parentPageId: parentPageId || null,
        createdById: session.userId,
        content: parseResult.data.content || DEFAULT_PAGE_CONTENT,
      },
      include: {
        createdBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    return NextResponse.json(
      {
        message: "Page created successfully",
        page,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[PAGE_CREATE_ERROR]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

