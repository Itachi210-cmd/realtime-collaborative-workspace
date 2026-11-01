import React, { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Bold,
  Italic,
  Underline,
  List,
  ListOrdered,
  Quote,
  Heading1,
  Heading2,
  Heading3,
  Link2,
  Undo2,
  Redo2,
  MessageSquare,
  History,
  FileQuestion,
  FileText,
  Clock,
  User,
  Shield,
  Layers,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/Button";
import { checkWorkspaceAccess } from "@/lib/auth/workspace-auth";
import { prisma } from "@/lib/prisma";

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

  const { workspace, isOwner } = authCheck.data;
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
      <div className="space-y-6">
        {/* Editor Toolbar Placeholder */}
        <div className="sticky top-0 z-10 -mx-4 -mt-4 px-4 py-2 bg-white/95 backdrop-blur-xs border-b border-[#e9e9e7] flex flex-wrap items-center justify-between gap-2 select-none">
          {/* Formatting Controls */}
          <div className="flex items-center gap-0.5 overflow-x-auto py-0.5">
            <button
              title="Heading 1"
              disabled
              className="p-1.5 rounded hover:bg-[#efefed] text-neutral-400 cursor-not-allowed"
            >
              <Heading1 className="w-3.5 h-3.5" />
            </button>
            <button
              title="Heading 2"
              disabled
              className="p-1.5 rounded hover:bg-[#efefed] text-neutral-400 cursor-not-allowed"
            >
              <Heading2 className="w-3.5 h-3.5" />
            </button>
            <button
              title="Heading 3"
              disabled
              className="p-1.5 rounded hover:bg-[#efefed] text-neutral-400 cursor-not-allowed"
            >
              <Heading3 className="w-3.5 h-3.5" />
            </button>

            <span className="w-px h-4 bg-neutral-200 mx-1"></span>

            <button
              title="Bold"
              disabled
              className="p-1.5 rounded hover:bg-[#efefed] text-neutral-400 cursor-not-allowed"
            >
              <Bold className="w-3.5 h-3.5" />
            </button>
            <button
              title="Italic"
              disabled
              className="p-1.5 rounded hover:bg-[#efefed] text-neutral-400 cursor-not-allowed"
            >
              <Italic className="w-3.5 h-3.5" />
            </button>
            <button
              title="Underline"
              disabled
              className="p-1.5 rounded hover:bg-[#efefed] text-neutral-400 cursor-not-allowed"
            >
              <Underline className="w-3.5 h-3.5" />
            </button>

            <span className="w-px h-4 bg-neutral-200 mx-1"></span>

            <button
              title="Bullet list"
              disabled
              className="p-1.5 rounded hover:bg-[#efefed] text-neutral-400 cursor-not-allowed"
            >
              <List className="w-3.5 h-3.5" />
            </button>
            <button
              title="Numbered list"
              disabled
              className="p-1.5 rounded hover:bg-[#efefed] text-neutral-400 cursor-not-allowed"
            >
              <ListOrdered className="w-3.5 h-3.5" />
            </button>
            <button
              title="Quote block"
              disabled
              className="p-1.5 rounded hover:bg-[#efefed] text-neutral-400 cursor-not-allowed"
            >
              <Quote className="w-3.5 h-3.5" />
            </button>
            <button
              title="Insert link"
              disabled
              className="p-1.5 rounded hover:bg-[#efefed] text-neutral-400 cursor-not-allowed"
            >
              <Link2 className="w-3.5 h-3.5" />
            </button>

            <span className="w-px h-4 bg-neutral-200 mx-1"></span>

            <button
              title="Undo"
              disabled
              className="p-1.5 rounded hover:bg-[#efefed] text-neutral-400 cursor-not-allowed"
            >
              <Undo2 className="w-3.5 h-3.5" />
            </button>
            <button
              title="Redo"
              disabled
              className="p-1.5 rounded hover:bg-[#efefed] text-neutral-400 cursor-not-allowed"
            >
              <Redo2 className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Right Toolbar Tools */}
          <div className="flex items-center gap-1.5">
            <button
              title="Comments (Phase 9)"
              className="flex items-center gap-1 px-2.5 py-1 text-xs text-neutral-500 hover:text-neutral-800 hover:bg-[#efefed] rounded transition-colors"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Comments</span>
            </button>
            <button
              title="Version History (Phase 10)"
              className="flex items-center gap-1 px-2.5 py-1 text-xs text-neutral-500 hover:text-neutral-800 hover:bg-[#efefed] rounded transition-colors"
            >
              <History className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">History</span>
            </button>
          </div>
        </div>

        {/* Document Header with Real PostgreSQL Data */}
        <div className="pt-6 pb-2 space-y-3">
          <div className="text-4xl select-none">📄</div>
          <h1 className="text-3xl sm:text-4xl font-bold text-[#37352f] tracking-tight leading-tight">
            {activePage.title}
          </h1>

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

          <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-400 pt-1 border-b border-[#e9e9e7]/60 pb-3">
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
            <span>Role: <strong className="text-emerald-700 font-semibold">{isOwner ? "Owner" : "Member"}</strong></span>
          </div>
        </div>

        {/* Phase Status Banner */}
        <div className="p-4 sm:p-5 border border-[#e5e7eb] rounded-xl bg-[#fafafa]/50 space-y-3">
          <div className="flex items-start gap-3">
            <FileText className="w-5 h-5 text-[#2383e2] shrink-0 mt-0.5" />
            <div className="space-y-1.5">
              <h3 className="text-sm font-semibold text-[#37352f]">
                Phase 4: Database Persistence Operational
              </h3>
              <p className="text-xs text-neutral-600 leading-relaxed">
                This document is persisted in PostgreSQL via Prisma with verified workspace membership and parent-child hierarchy support.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 text-xs text-neutral-600">
                <div className="p-2.5 bg-white border border-[#e9e9e7] rounded-md">
                  <span className="font-semibold text-neutral-800 block">Phase 5 (Next):</span>
                  <span>TipTap rich-text editor DOM engine</span>
                </div>
                <div className="p-2.5 bg-white border border-[#e9e9e7] rounded-md">
                  <span className="font-semibold text-neutral-800 block">Phase 6 &amp; 7:</span>
                  <span>Yjs CRDT &amp; live WebSocket collaborative editing</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Child Pages Quick Links if any */}
        {activePage.childPages.length > 0 && (
          <div className="space-y-2 pt-2">
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
