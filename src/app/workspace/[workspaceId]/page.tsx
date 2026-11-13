import React, { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  FileQuestion,
  Shield,
  Layers,
  FileText,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
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
      <div className="min-h-screen bg-[var(--bg-app)] flex flex-col items-center justify-center p-6 text-center space-y-4">
        <div className="w-12 h-12 rounded-full bg-red-500/10 text-red-600 dark:text-red-400 flex items-center justify-center">
          <Shield className="w-6 h-6" />
        </div>
        <div className="space-y-1.5 max-w-sm">
          <h1 className="font-serif-editorial text-2xl font-normal text-[var(--text-primary)]">
            Access Restricted
          </h1>
          <p className="text-xs text-[var(--text-muted)]">
            {authCheck.error || "You do not have permission to view this workspace."}
          </p>
        </div>
        <Link
          href="/dashboard"
          className="inline-flex items-center justify-center font-medium rounded-md transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20 bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] border border-[var(--accent)] text-xs px-2.5 py-1 gap-1.5 h-7 shadow-xs cursor-pointer"
        >
          Back to Dashboard
        </Link>
      </div>
    );
  }

  const { workspace, isOwner, membership } = authCheck.data;
  const canEdit = isOwner || membership?.role === Role.EDITOR;
  const effectiveRole = isOwner ? "OWNER" : (membership?.role || "VIEWER");
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
      <AppShell workspaceId={workspaceId} pageTitle={workspace.name} userRole={effectiveRole}>
        <div className="py-16 px-4 text-center max-w-md mx-auto space-y-5">
          <div className="w-12 h-12 rounded-full bg-[var(--accent-light)] text-[var(--accent)] flex items-center justify-center mx-auto border border-[var(--accent-border)]/30">
            <Layers className="w-6 h-6" />
          </div>

          <div className="space-y-1.5">
            <h1 className="font-serif-editorial text-2xl font-normal tracking-tight text-[var(--text-primary)]">
              {workspace.name}
            </h1>
            <p className="text-xs text-[var(--text-muted)] leading-relaxed">
              {workspacePages.length === 0
                ? "This workspace does not have any documents yet. Use the sidebar on the left to add your first page."
                : "Select a document from the sidebar page tree to view and collaborate."}
            </p>
          </div>

          <div className="pt-2 flex items-center justify-center gap-2">
            {workspacePages.length > 0 && (
              <Link
                href={`/workspace/${workspaceId}?page=${workspacePages[0].id}`}
                className="inline-flex items-center justify-center font-medium rounded-md transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20 bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] border border-[var(--accent)] text-xs px-2.5 py-1 gap-1.5 h-7 shadow-xs cursor-pointer"
              >
                <span>Open &ldquo;{workspacePages[0].title}&rdquo;</span>
              </Link>
            )}
            <Link
              href="/dashboard"
              className="inline-flex items-center justify-center font-medium rounded-md transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20 bg-[var(--bg-raised)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-xs px-2.5 py-1 gap-1.5 h-7 cursor-pointer"
            >
              <span>Dashboard</span>
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
        <div className="py-16 px-4 text-center max-w-md mx-auto space-y-4">
          <div className="w-12 h-12 rounded-full bg-[var(--bg-raised)] text-[var(--text-faint)] flex items-center justify-center mx-auto border border-[var(--border-subtle)]">
            <FileQuestion className="w-6 h-6" />
          </div>
          <div className="space-y-1.5">
            <h1 className="font-serif-editorial text-2xl font-normal tracking-tight text-[var(--text-primary)]">
              Document Not Found
            </h1>
            <p className="text-xs text-[var(--text-muted)] leading-relaxed">
              The requested document does not exist in this workspace or was removed.
            </p>
          </div>
          <div className="pt-2">
            <Link
              href={`/workspace/${workspaceId}`}
              className="inline-flex items-center justify-center font-medium rounded-md transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20 bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] border border-[var(--accent)] text-xs px-2.5 py-1 gap-1.5 h-7 shadow-xs cursor-pointer"
            >
              <span>View Workspace Overview</span>
            </Link>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell workspaceId={workspaceId} pageTitle={activePage.title} userRole={effectiveRole}>
      <div className="space-y-6">
        {/* TipTap Rich-Text Editor Canvas on Centered Manuscript Sheet */}
        <RichTextEditor
          key={activePage.id}
          workspaceId={workspaceId}
          pageId={activePage.id}
          initialTitle={activePage.title}
          initialContent={activePage.content as JSONContent | null}
          isEditable={canEdit}
          authorName={activePage.createdBy?.name || "Member"}
          updatedAt={activePage.updatedAt}
          parentPage={activePage.parentPage}
          currentUser={{
            id: authCheck.data.session.userId,
            name: authCheck.data.session.name,
            email: authCheck.data.session.email,
            role: effectiveRole,
          }}
        />

        {/* Child Pages Quick Links if any */}
        {activePage.childPages.length > 0 && (
          <div className="max-w-[780px] mx-auto px-2 sm:px-0 pt-4 space-y-2 border-t border-[var(--border-subtle)]">
            <h4 className="text-[11px] font-mono uppercase tracking-wider text-[var(--text-faint)]">
              Subpages ({activePage.childPages.length})
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {activePage.childPages.map((child) => (
                <Link
                  key={child.id}
                  href={`/workspace/${workspaceId}?page=${child.id}`}
                  className="flex items-center gap-2.5 p-2.5 rounded-md border border-[var(--border-subtle)] hover:border-[var(--accent-border)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] transition-colors group"
                >
                  <FileText className="w-3.5 h-3.5 text-[var(--text-faint)] group-hover:text-[var(--accent)] shrink-0 transition-colors" />
                  <span className="text-xs font-medium text-[var(--text-primary)] group-hover:text-[var(--accent)] truncate transition-colors">
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
        <div className="min-h-screen flex items-center justify-center p-8 bg-[var(--bg-app)] text-[var(--text-faint)] font-mono text-xs">
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
