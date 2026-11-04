import React, { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  FileQuestion,
  Clock,
  User,
  Shield,
  Layers,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/Button";
import { checkWorkspaceAccess } from "@/lib/auth/workspace-auth";
import { prisma } from "@/lib/prisma";
import { RichTextEditor } from "@/components/editor/RichTextEditor";
import { Role } from "@prisma/client";
import { type JSONContent } from "@tiptap/react";

interface WorkspacePageProps {
  params: Promise<{
    workspaceId: string;
  }>;
  searchParams?: Promise<{
    page?: string;
  }>;
}

async function WorkspaceDocument({
  workspaceId,
  searchParamsPromise,
}: {
  workspaceId: string;
  searchParamsPromise?: Promise<{ page?: string }>;
}) {
  const authCheck = await checkWorkspaceAccess(workspaceId);

  // If unauthorized or forbidden
  if (!authCheck.success) {
    if (authCheck.status === 404) {
      notFound();
    }
    return (
      <div className="min-h-screen bg-[#fafafa] flex flex-col items-center justify-center p-6 text-center space-y-4">
        <div className="w-12 h-12 rounded-full bg-red-100 text-red-600 flex items-center justify-center">
          <Shield className="w-6 h-6" />
        </div>
        <div className="space-y-1.5 max-w-sm">
          <h1 className="text-xl font-bold text-[#37352f]">Access Restricted</h1>
          <p className="text-xs text-neutral-500">
            {authCheck.error || "You do not have permission to view this workspace."}
          </p>
        </div>
        <Link href="/dashboard">
          <Button variant="primary" size="sm">
            Back to Dashboard
          </Button>
        </Link>
      </div>
    );
  }

  const { workspace, isOwner, membership } = authCheck.data;
  const canEdit = isOwner || membership?.role === Role.EDITOR;
  const resolvedSearchParams = searchParamsPromise ? await searchParamsPromise : undefined;
  const pageId = resolvedSearchParams?.page;

  // Fetch all pages for this workspace to check if any exist
  const workspacePages = await prisma.page.findMany({
    where: { workspaceId },
    select: { id: true, title: true },
    orderBy: { createdAt: "asc" },
  });

  // Case 1: No page selected in query
  if (!pageId) {
    return (
      <AppShell workspaceId={workspaceId} pageTitle={workspace.name}>
        <div className="py-12 px-4 text-center max-w-md mx-auto space-y-5">
          <div className="w-12 h-12 rounded-full bg-blue-50 text-[#2383e2] flex items-center justify-center mx-auto">
            <Layers className="w-6 h-6" />
          </div>

          <div className="space-y-1.5">
            <h1 className="text-xl font-bold tracking-tight text-[#37352f]">
              {workspace.name}
            </h1>
            <p className="text-xs text-neutral-500 leading-relaxed">
              {workspacePages.length === 0
                ? "This workspace does not have any documents yet. Use the sidebar on the left to add your first page."
                : "Select a document from the sidebar page tree to view and collaborate."}
            </p>
          </div>

          <div className="pt-2 flex items-center justify-center gap-2">
            {workspacePages.length > 0 && (
              <Link href={`/workspace/${workspaceId}?page=${workspacePages[0].id}`}>
                <Button variant="primary" size="sm">
                  <span>Open &ldquo;{workspacePages[0].title}&rdquo;</span>
                </Button>
              </Link>
            )}
            <Link href="/dashboard">
              <Button variant="secondary" size="sm">
                <span>Dashboard</span>
              </Button>
            </Link>
          </div>
        </div>
      </AppShell>
    );
  }

  // Case 2: Page is selected -> retrieve from PostgreSQL
  const activePage = await prisma.page.findUnique({
    where: { id: pageId },
    include: {
      createdBy: {
        select: { id: true, name: true, email: true },
      },
      parentPage: {
        select: { id: true, title: true },
      },
      childPages: {
        select: { id: true, title: true },
      },
    },
  });

  // Handle invalid or cross-workspace page query
  if (!activePage || activePage.workspaceId !== workspaceId) {
    return (
      <AppShell workspaceId={workspaceId} pageTitle="Document Not Found">
        <div className="py-12 px-4 text-center max-w-md mx-auto space-y-4">
          <div className="w-12 h-12 rounded-full bg-neutral-100 text-neutral-400 flex items-center justify-center mx-auto">
            <FileQuestion className="w-6 h-6" />
          </div>
          <div className="space-y-1.5">
            <h1 className="text-xl font-bold tracking-tight text-[#37352f]">
              Document Not Found
            </h1>
            <p className="text-xs text-neutral-500 leading-relaxed">
              The requested document does not exist in this workspace or was removed.
            </p>
          </div>
          <div className="pt-2">
            <Link href={`/workspace/${workspaceId}`}>
              <Button variant="primary" size="sm">
                <span>View Workspace Overview</span>
              </Button>
            </Link>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell workspaceId={workspaceId} pageTitle={activePage.title}>
      <div className="space-y-4">
        {/* Document Metadata & Hierarchy Header */}
        <div className="max-w-[768px] mx-auto px-4 sm:px-6 pt-2 space-y-2">
          {activePage.parentPage && (
            <div className="flex items-center gap-1.5 text-xs text-neutral-500">
              <span>Parent Document:</span>
              <Link
                href={`/workspace/${workspaceId}?page=${activePage.parentPage.id}`}
                className="text-[#2383e2] hover:underline font-medium"
              >
                {activePage.parentPage.title}
              </Link>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-400">
            <span className="flex items-center gap-1">
              <User className="w-3.5 h-3.5 text-neutral-400" />
              <span>Created by {activePage.createdBy?.name || "Member"}</span>
            </span>
            <span>•</span>
            <span className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5 text-neutral-400" />
              <span>{new Date(activePage.updatedAt).toLocaleDateString()}</span>
            </span>
            <span>•</span>
            <span>
              Role:{" "}
              <strong className="text-emerald-700 font-semibold">
                {isOwner ? "Owner" : membership?.role || "Member"}
              </strong>
            </span>
          </div>
        </div>

        {/* TipTap Rich-Text Editor Canvas */}
        <RichTextEditor
          key={activePage.id}
          workspaceId={workspaceId}
          pageId={activePage.id}
          initialTitle={activePage.title}
          initialContent={activePage.content as JSONContent | null}
          isEditable={canEdit}
          currentUser={{
            id: authCheck.data.session.userId,
            name: authCheck.data.session.name,
            email: authCheck.data.session.email,
            role: isOwner ? "OWNER" : membership?.role || "EDITOR",
          }}
        />

        {/* Child Pages Quick Links if any */}
        {activePage.childPages.length > 0 && (
          <div className="max-w-[768px] mx-auto px-4 sm:px-6 pt-4 space-y-2 border-t border-neutral-100">
            <h4 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">
              Subpages ({activePage.childPages.length})
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {activePage.childPages.map((child) => (
                <Link
                  key={child.id}
                  href={`/workspace/${workspaceId}?page=${child.id}`}
                  className="flex items-center gap-2.5 p-2.5 rounded-lg border border-[#e9e9e7] hover:border-[#2383e2] bg-white transition-colors"
                >
                  <span className="text-sm">📄</span>
                  <span className="text-xs font-medium text-[#37352f] truncate">
                    {child.title}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

export default async function WorkspaceViewPage({
  params,
  searchParams,
}: WorkspacePageProps) {
  const resolvedParams = await params;

  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center p-8 bg-white text-neutral-400 text-sm">
          Loading workspace...
        </div>
      }
    >
      <WorkspaceDocument
        workspaceId={resolvedParams.workspaceId}
        searchParamsPromise={searchParams}
      />
    </Suspense>
  );
}
