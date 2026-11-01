import { NextResponse } from "next/server";
import { checkWorkspaceAccess } from "@/lib/auth/workspace-auth";
import { updatePageSchema } from "@/lib/validations/page";
import { prisma } from "@/lib/prisma";

interface RouteParams {
  params: Promise<{
    workspaceId: string;
    pageId: string;
  }>;
}

/**
 * GET /api/workspaces/[workspaceId]/pages/[pageId]
 * Retrieves page details. Verifies that the page belongs to the workspace and the user has membership.
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { workspaceId, pageId } = await params;
    const authCheck = await checkWorkspaceAccess(workspaceId);
    if (!authCheck.success) {
      return NextResponse.json(
        { error: authCheck.error },
        { status: authCheck.status }
      );
    }

    const page = await prisma.page.findUnique({
      where: { id: pageId },
      include: {
        createdBy: {
          select: { id: true, name: true, email: true },
        },
        parentPage: {
          select: { id: true, title: true },
        },
        childPages: {
          select: { id: true, title: true, createdAt: true },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!page || page.workspaceId !== workspaceId) {
      return NextResponse.json({ error: "Page not found" }, { status: 404 });
    }

    return NextResponse.json({ page }, { status: 200 });
  } catch (error) {
    console.error("[PAGE_GET_ERROR]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/workspaces/[workspaceId]/pages/[pageId]
 * Renames a page in the workspace.
 */
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { workspaceId, pageId } = await params;
    const authCheck = await checkWorkspaceAccess(workspaceId);
    if (!authCheck.success) {
      return NextResponse.json(
        { error: authCheck.error },
        { status: authCheck.status }
      );
    }

    // Verify page exists and belongs to the workspace
    const existingPage = await prisma.page.findUnique({
      where: { id: pageId },
      select: { id: true, workspaceId: true },
    });

    if (!existingPage || existingPage.workspaceId !== workspaceId) {
      return NextResponse.json({ error: "Page not found" }, { status: 404 });
    }

    const body = await request.json();
    const parseResult = updatePageSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: "Invalid input",
          issues: parseResult.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const updatedPage = await prisma.page.update({
      where: { id: pageId },
      data: {
        title: parseResult.data.title,
      },
      include: {
        createdBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    return NextResponse.json(
      {
        message: "Page updated successfully",
        page: updatedPage,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[PAGE_PATCH_ERROR]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/workspaces/[workspaceId]/pages/[pageId]
 * Deletes a page and any nested descendants.
 */
export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    const { workspaceId, pageId } = await params;
    const authCheck = await checkWorkspaceAccess(workspaceId);
    if (!authCheck.success) {
      return NextResponse.json(
        { error: authCheck.error },
        { status: authCheck.status }
      );
    }

    const existingPage = await prisma.page.findUnique({
      where: { id: pageId },
      select: { id: true, workspaceId: true },
    });

    if (!existingPage || existingPage.workspaceId !== workspaceId) {
      return NextResponse.json({ error: "Page not found" }, { status: 404 });
    }

    await prisma.page.delete({
      where: { id: pageId },
    });

    return NextResponse.json(
      { message: "Page deleted successfully" },
      { status: 200 }
    );
  } catch (error) {
    console.error("[PAGE_DELETE_ERROR]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

