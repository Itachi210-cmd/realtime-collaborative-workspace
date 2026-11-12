import { NextRequest, NextResponse } from "next/server";
import { checkWorkspaceAccess } from "@/lib/auth/workspace-auth";
import { updatePageSchema } from "@/lib/validations/page";
import { prisma } from "@/lib/prisma";
import { Prisma, Role } from "@prisma/client";
import { workspaceEvents } from "@/lib/events/workspace-events";
import {
  NO_STORE_HEADERS,
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
 * GET /api/workspaces/[workspaceId]/pages/[pageId]
 * Retrieves page details. Verifies that the page belongs to the workspace and the user has membership.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { workspaceId, pageId } = await params;
    const authCheck = await checkWorkspaceAccess(workspaceId);
    if (!authCheck.success) {
      return NextResponse.json(
        { error: authCheck.error },
        { status: authCheck.status, headers: NO_STORE_HEADERS }
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
      return NextResponse.json(
        { error: "Page not found" },
        { status: 404, headers: NO_STORE_HEADERS }
      );
    }

    return NextResponse.json({ page }, { status: 200, headers: NO_STORE_HEADERS });
  } catch (error) {
    logStructured("error", "PageAPI", "get_failed", { error });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}

/**
 * PATCH /api/workspaces/[workspaceId]/pages/[pageId]
 * Updates a page's title and/or rich-text content in the workspace.
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const csrfError = verifySameOriginCsrf(request);
    if (csrfError) return csrfError;

    const { workspaceId, pageId } = await params;
    const authCheck = await checkWorkspaceAccess(workspaceId);
    if (!authCheck.success) {
      return NextResponse.json(
        { error: authCheck.error },
        { status: authCheck.status, headers: NO_STORE_HEADERS }
      );
    }

    const { isOwner, membership } = authCheck.data;
    const canEdit = isOwner || membership?.role === Role.EDITOR;
    if (!canEdit) {
      return NextResponse.json(
        { error: "Forbidden: You do not have permission to edit documents in this workspace" },
        { status: 403, headers: NO_STORE_HEADERS }
      );
    }

    // Verify page exists and belongs to the workspace
    const existingPage = await prisma.page.findUnique({
      where: { id: pageId },
      select: { id: true, workspaceId: true },
    });

    if (!existingPage || existingPage.workspaceId !== workspaceId) {
      return NextResponse.json(
        { error: "Page not found" },
        { status: 404, headers: NO_STORE_HEADERS }
      );
    }

    const parsedBody = await readJsonBody(request, 2.5 * 1024 * 1024);
    if (!parsedBody.ok) return parsedBody.response;

    const parseResult = updatePageSchema.safeParse(parsedBody.data);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: "Invalid input",
          issues: parseResult.error.flatten().fieldErrors,
        },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    const updateData: { title?: string; content?: Prisma.InputJsonValue } = {};
    if (parseResult.data.title !== undefined) {
      updateData.title = parseResult.data.title;
    }
    if (parseResult.data.content !== undefined) {
      updateData.content = parseResult.data.content as Prisma.InputJsonValue;
    }

    const updatedPage = await prisma.page.update({
      where: { id: pageId },
      data: updateData,
      include: {
        createdBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    // Broadcast real-time page update event to all members of this workspace
    workspaceEvents.emitWorkspaceEvent(workspaceId, {
      type: "PAGE_UPDATED",
      page: {
        id: updatedPage.id,
        title: updatedPage.title,
        parentPageId: updatedPage.parentPageId,
        workspaceId: updatedPage.workspaceId,
        createdAt: updatedPage.createdAt,
        updatedAt: updatedPage.updatedAt,
      },
    });

    return NextResponse.json(
      {
        message: "Page updated successfully",
        page: updatedPage,
      },
      { status: 200, headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    logStructured("error", "PageAPI", "patch_failed", { error });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}

/**
 * DELETE /api/workspaces/[workspaceId]/pages/[pageId]
 * Deletes a page and any nested descendants.
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const csrfError = verifySameOriginCsrf(request);
    if (csrfError) return csrfError;

    const { workspaceId, pageId } = await params;
    const authCheck = await checkWorkspaceAccess(workspaceId);
    if (!authCheck.success) {
      return NextResponse.json(
        { error: authCheck.error },
        { status: authCheck.status, headers: NO_STORE_HEADERS }
      );
    }

    const { isOwner, membership } = authCheck.data;
    const effectiveRole: Role = isOwner ? Role.OWNER : (membership?.role as Role);

    if (effectiveRole !== Role.OWNER && effectiveRole !== Role.EDITOR) {
      return NextResponse.json(
        {
          error:
            "Forbidden: You do not have permission to delete pages in this workspace.",
        },
        { status: 403, headers: NO_STORE_HEADERS }
      );
    }

    const existingPage = await prisma.page.findUnique({
      where: { id: pageId },
      select: { id: true, workspaceId: true },
    });

    if (!existingPage || existingPage.workspaceId !== workspaceId) {
      return NextResponse.json(
        { error: "Page not found" },
        { status: 404, headers: NO_STORE_HEADERS }
      );
    }

    await prisma.page.delete({
      where: { id: pageId },
    });

    // Broadcast real-time page deletion event to all members of this workspace
    workspaceEvents.emitWorkspaceEvent(workspaceId, {
      type: "PAGE_DELETED",
      pageId,
      workspaceId,
    });

    return NextResponse.json(
      { message: "Page deleted successfully" },
      { status: 200, headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    logStructured("error", "PageAPI", "delete_failed", { error });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}

