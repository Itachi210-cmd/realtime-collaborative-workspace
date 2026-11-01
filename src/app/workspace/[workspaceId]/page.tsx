import React, { Suspense } from "react";
import Link from "next/link";
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
  Info,
  FileQuestion,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/Button";

interface WorkspacePageProps {
  params: Promise<{
    workspaceId: string;
  }>;
  searchParams?: Promise<{
    page?: string;
  }>;
}

interface PageMeta {
  title: string;
  icon: string;
  description: string;
}

const PAGE_DETAILS: Record<string, PageMeta> = {
  "getting-started": {
    title: "Getting Started with CollabWorkspace",
    icon: "🚀",
    description: "Overview of collaborative spaces, editing rules, and real-time synchronization.",
  },
  quickstart: {
    title: "Quickstart Guide",
    icon: "⚡",
    description: "Step-by-step instructions to create pages, invite collaborators, and edit concurrently.",
  },
  "architecture-overview": {
    title: "Architecture Blueprint",
    icon: "📐",
    description: "Two-tier architecture: relational app tier (PostgreSQL) and real-time CRDT tier (Yjs).",
  },
  "project-spec": {
    title: "Project Blueprint & Specifications",
    icon: "📚",
    description: "Functional requirements, non-functional constraints, and role-based permissions.",
  },
  "crdt-spec": {
    title: "CRDT & Yjs Synchronization",
    icon: "🔄",
    description: "Conflict-free replicated data types, awareness states, and convergence mechanisms.",
  },
  "schema-spec": {
    title: "PostgreSQL Data Models & Prisma",
    icon: "🗄️",
    description: "Prisma schema specifications: users, workspaces, memberships, and binary Yjs document state.",
  },
  "meeting-notes": {
    title: "Weekly Engineering Sync & Roadmap",
    icon: "📝",
    description: "Action items, phase velocity tracking, and architectural review logs.",
  },
  "sprint-roadmap": {
    title: "Sprint Goals & Milestones",
    icon: "🎯",
    description: "Phases 1 through 14 execution plan leading to final submission and demonstration.",
  },
};

async function WorkspaceDocument({
  workspaceId,
  searchParamsPromise,
}: {
  workspaceId: string;
  searchParamsPromise?: Promise<{ page?: string }>;
}) {
  const resolvedSearchParams = searchParamsPromise ? await searchParamsPromise : undefined;
  const pageId = resolvedSearchParams?.page;

  // Case 1: Empty workspace or no page selected in URL
  if (!pageId) {
    return (
      <AppShell workspaceId={workspaceId} pageTitle="Workspace Overview">
        <div className="py-12 px-4 text-center max-w-md mx-auto space-y-4">
          <div className="w-12 h-12 rounded-full bg-neutral-100 flex items-center justify-center mx-auto text-neutral-400">
            <FileQuestion className="w-6 h-6" />
          </div>

          <div className="space-y-1.5">
            <h1 className="text-xl font-bold tracking-tight text-[#37352f]">
              No Document Selected
            </h1>
            <p className="text-xs text-neutral-500 leading-relaxed">
              Select a page from the sidebar tree on the left, or create a new document to start real-time editing.
            </p>
          </div>

          <div className="pt-2 flex items-center justify-center gap-2">
            <Link href={`/workspace/${workspaceId}?page=getting-started`}>
              <Button variant="primary" size="sm">
                <span>Open &ldquo;Getting Started&rdquo;</span>
              </Button>
            </Link>
            <Link href="/dashboard">
              <Button variant="secondary" size="sm">
                <span>Back to Dashboard</span>
              </Button>
            </Link>
          </div>
        </div>
      </AppShell>
    );
  }

  // Case 2: Page is selected
  const page = PAGE_DETAILS[pageId] || {
    title: pageId.startsWith("page-") ? `Document (${pageId})` : pageId.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    icon: "📄",
    description: "Collaborative page in this workspace.",
  };

  return (
    <AppShell workspaceId={workspaceId} pageTitle={page.title}>
      <div className="space-y-6">
        {/* Editor Action Bar / Toolbar Placeholder */}
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

          {/* Right Toolbar Tools: Comments, Version History */}
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

        {/* Document Header */}
        <div className="pt-6 pb-2 space-y-3">
          <div className="text-4xl select-none">{page.icon}</div>
          <h1 className="text-3xl sm:text-4xl font-bold text-[#37352f] tracking-tight outline-none focus:ring-0 leading-tight">
            {page.title}
          </h1>
          <p className="text-sm text-neutral-500 leading-normal">
            {page.description}
          </p>
          <div className="flex items-center gap-3 text-xs text-neutral-400 pt-1 border-b border-[#e9e9e7]/60 pb-3">
            <span>Workspace: <strong className="text-neutral-700">{workspaceId}</strong></span>
            <span>•</span>
            <span>Page ID: <strong className="text-neutral-700">{pageId}</strong></span>
            <span>•</span>
            <span>Role: <strong className="text-emerald-700 font-semibold">Owner</strong></span>
          </div>
        </div>

        {/* Phase 2 Application Shell Info */}
        <div className="p-4 sm:p-5 border border-[#e5e7eb] rounded-xl bg-[#fafafa]/50 space-y-3">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-[#2383e2] shrink-0 mt-0.5" />
            <div className="space-y-1.5">
              <h3 className="text-sm font-semibold text-[#37352f]">
                Phase 2 UI Shell Active
              </h3>
              <p className="text-xs text-neutral-600 leading-relaxed">
                The responsive shell, nested sidebar page tree, workspace switcher, and modal dialogs are fully interactive.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 text-xs text-neutral-600">
                <div className="p-2.5 bg-white border border-[#e9e9e7] rounded-md">
                  <span className="font-semibold text-neutral-800 block">Phase 5 (Next Engine):</span>
                  <span>TipTap rich-text editor DOM integration</span>
                </div>
                <div className="p-2.5 bg-white border border-[#e9e9e7] rounded-md">
                  <span className="font-semibold text-neutral-800 block">Phase 6 &amp; 7 (Real-time):</span>
                  <span>Yjs CRDT synchronization &amp; live presence cursors</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Sample Content Blocks Showing Notion Typography */}
        <div className="space-y-4 pt-2 text-sm text-[#37352f] leading-relaxed">
          <p>
            Welcome to the future home of your real-time collaborative document. In this workspace, changes will stream seamlessly across all connected collaborators using CRDT mathematics guaranteed by Yjs.
          </p>
          <div className="pl-4 border-l-2 border-[#2383e2] italic text-neutral-600 bg-neutral-50/50 py-2 my-2 rounded-r">
            &ldquo;Concurrent edits converge to a single truth without last-write-wins collisions or lost edits.&rdquo;
          </div>
          <p className="text-neutral-500 text-xs">
            Use the nested Page Tree on the sidebar to switch between documents, expand parent folders, or test adding/renaming pages.
          </p>
        </div>
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
