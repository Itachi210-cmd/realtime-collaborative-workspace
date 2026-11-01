"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  Plus,
  Clock,
  FolderPlus,
  Search,
  ExternalLink,
  ChevronRight,
  Code2,
  FileQuestion,
  FileText,
  RotateCcw,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";

interface DashboardPageItem {
  id: string;
  title: string;
  updatedAt: string;
  icon: string;
  role: string;
}

const INITIAL_PAGES: DashboardPageItem[] = [
  {
    id: "getting-started",
    title: "Getting Started with CollabWorkspace",
    updatedAt: "10 mins ago",
    icon: "🚀",
    role: "Owner",
  },
  {
    id: "project-spec",
    title: "System Architecture & CRDT Specifications",
    updatedAt: "1 hour ago",
    icon: "📐",
    role: "Editor",
  },
  {
    id: "meeting-notes",
    title: "Weekly Engineering Sync & Roadmap",
    updatedAt: "Yesterday",
    icon: "📝",
    role: "Editor",
  },
];

export default function DashboardPage() {
  const { addToast } = useToast();
  const [pages, setPages] = useState<DashboardPageItem[]>(INITIAL_PAGES);
  const [searchQuery, setSearchQuery] = useState("");
  const [isCreatePageOpen, setIsCreatePageOpen] = useState(false);
  const [newPageTitle, setNewPageTitle] = useState("");
  const [isCreateWsOpen, setIsCreateWsOpen] = useState(false);
  const [newWsName, setNewWsName] = useState("");

  const filteredPages = pages.filter((page) =>
    page.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleCreatePage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPageTitle.trim()) return;

    const newPage: DashboardPageItem = {
      id: `page-${Date.now().toString().slice(-4)}`,
      title: newPageTitle.trim(),
      updatedAt: "Just now",
      icon: "📄",
      role: "Owner",
    };

    setPages((prev) => [newPage, ...prev]);
    setIsCreatePageOpen(false);
    setNewPageTitle("");

    addToast({
      message: "Document created",
      description: `"${newPage.title}" has been added to your workspace.`,
      variant: "success",
    });
  };

  const handleCreateWorkspace = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWsName.trim()) return;

    setIsCreateWsOpen(false);
    setNewWsName("");

    addToast({
      message: "Workspace created",
      description: `New workspace "${newWsName.trim()}" initialized (client state).`,
      variant: "success",
    });
  };

  const handleToggleEmptyWorkspace = () => {
    if (pages.length > 0) {
      setPages([]);
      addToast({
        message: "Simulated empty workspace",
        description: "Viewing empty state per blueprint requirements.",
        variant: "info",
      });
    } else {
      setPages(INITIAL_PAGES);
      addToast({
        message: "Restored sample documents",
        description: "Default documents reloaded.",
        variant: "info",
      });
    }
  };

  return (
    <AppShell pageTitle="Dashboard">
      <div className="space-y-8">
        {/* Welcome Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 border-b border-[#e9e9e7]">
          <div>
            <h1 className="text-2xl font-bold text-[#37352f] tracking-tight">
              Good day, Engineer
            </h1>
            <p className="text-sm text-neutral-500 mt-1">
              Welcome to your collaborative workspace dashboard.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleToggleEmptyWorkspace}
              title="Toggle between populated and empty workspace state"
              className="text-xs"
            >
              <RotateCcw className="w-3.5 h-3.5 mr-1 text-neutral-400" />
              <span>{pages.length === 0 ? "Restore Sample Data" : "Test Empty State"}</span>
            </Button>

            <Button
              variant="primary"
              size="sm"
              onClick={() => setIsCreatePageOpen(true)}
            >
              <Plus className="w-4 h-4 mr-1.5" />
              <span>New Page</span>
            </Button>
          </div>
        </div>

        {/* Development Phase 2 Status Pill */}
        <div className="p-4 rounded-lg bg-blue-50/50 border border-blue-100 flex items-start gap-3">
          <Code2 className="w-5 h-5 text-[#2383e2] shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h3 className="text-xs font-semibold text-blue-900 uppercase tracking-wider">
              Phase 2: UI Shell &amp; Navigation Active
            </h3>
            <p className="text-xs text-blue-800/80 leading-relaxed">
              Interactive workspace switching, nested page trees, dialogs, toast alerts, dynamic search filtering, and empty states are operational on the client. Database persistence will be integrated in Phase 4.
            </p>
          </div>
        </div>

        {/* Quick Actions & Search */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              type="text"
              placeholder="Filter recent documents..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm bg-[#fafafa] border border-[#e5e7eb] rounded-md text-[#37352f] placeholder:text-neutral-400 focus:outline-none focus:bg-white focus:border-[#2383e2] transition-colors"
            />
          </div>
          <Button
            variant="outline"
            className="text-xs"
            onClick={() => setIsCreateWsOpen(true)}
          >
            <FolderPlus className="w-3.5 h-3.5 mr-1.5 text-neutral-500" />
            <span>Create Workspace</span>
          </Button>
        </div>

        {/* Recent Pages Section */}
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs font-semibold text-neutral-500 uppercase tracking-wider">
            <span className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              <span>Recent Documents</span>
            </span>
            <span className="text-neutral-400 text-[11px] font-normal normal-case">
              {filteredPages.length} {filteredPages.length === 1 ? "document" : "documents"}
            </span>
          </div>

          {/* Empty Workspace State (02_UI_DESIGN_WORKFLOW.md Section 3.B) */}
          {pages.length === 0 ? (
            <div className="p-10 border border-dashed border-[#e5e7eb] rounded-xl bg-[#fafafa]/50 text-center space-y-3">
              <div className="w-10 h-10 rounded-full bg-neutral-100 flex items-center justify-center mx-auto text-neutral-400">
                <FileText className="w-5 h-5" />
              </div>
              <div className="space-y-1 max-w-sm mx-auto">
                <h3 className="text-sm font-semibold text-[#37352f]">
                  No documents in this workspace yet
                </h3>
                <p className="text-xs text-neutral-500 leading-relaxed">
                  Get started by creating your first document to collaborate with your team in real time.
                </p>
              </div>
              <Button
                variant="primary"
                size="sm"
                onClick={() => setIsCreatePageOpen(true)}
              >
                <Plus className="w-3.5 h-3.5 mr-1" />
                <span>Create Your First Page</span>
              </Button>
            </div>
          ) : filteredPages.length === 0 ? (
            /* Empty Search Results State */
            <div className="p-8 border border-[#e9e9e7] rounded-xl bg-white text-center space-y-2">
              <FileQuestion className="w-8 h-8 text-neutral-300 mx-auto" />
              <h4 className="text-sm font-medium text-[#37352f]">
                No documents matching &ldquo;{searchQuery}&rdquo;
              </h4>
              <p className="text-xs text-neutral-400">
                Try searching with a different keyword or create a new page.
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSearchQuery("")}
                className="text-xs text-[#2383e2]"
              >
                Clear Search Filter
              </Button>
            </div>
          ) : (
            <div className="grid gap-2">
              {filteredPages.map((page) => (
                <Link
                  key={page.id}
                  href={`/workspace/ws-main?page=${page.id}`}
                  className="group flex items-center justify-between p-3.5 bg-white border border-[#e9e9e7] hover:border-[#d0d0ce] rounded-lg transition-all hover:shadow-xs"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-xl shrink-0">{page.icon}</span>
                    <div className="flex flex-col min-w-0">
                      <span className="text-sm font-medium text-[#37352f] group-hover:text-[#2383e2] transition-colors truncate">
                        {page.title}
                      </span>
                      <span className="text-xs text-neutral-400">
                        Edited {page.updatedAt}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-neutral-100 text-neutral-600">
                      {page.role}
                    </span>
                    <ChevronRight className="w-4 h-4 text-neutral-300 group-hover:text-neutral-600 group-hover:translate-x-0.5 transition-all" />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Workspace Details Card */}
        <div className="border border-[#e9e9e7] rounded-lg p-5 bg-[#fafafa]/50 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-md bg-[#2383e2] text-white flex items-center justify-center font-bold text-sm">
                W
              </div>
              <div>
                <h2 className="text-sm font-semibold text-[#37352f]">
                  Engineering Workspace
                </h2>
                <p className="text-xs text-neutral-400">ID: ws-main • Free Tier (₹0)</p>
              </div>
            </div>
            <Link href="/workspace/ws-main">
              <Button variant="secondary" size="sm">
                <span>Open Workspace</span>
                <ExternalLink className="w-3.5 h-3.5 ml-1.5" />
              </Button>
            </Link>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 text-xs text-neutral-500">
            <div className="p-3 bg-white border border-[#e9e9e7] rounded-md">
              <span className="text-neutral-400 block text-[11px]">Role</span>
              <strong className="text-neutral-800 font-semibold">Workspace Owner</strong>
            </div>
            <div className="p-3 bg-white border border-[#e9e9e7] rounded-md">
              <span className="text-neutral-400 block text-[11px]">Members</span>
              <strong className="text-neutral-800 font-semibold">4 Collaborators</strong>
            </div>
            <div className="p-3 bg-white border border-[#e9e9e7] rounded-md">
              <span className="text-neutral-400 block text-[11px]">Storage Mode</span>
              <strong className="text-neutral-800 font-semibold">PostgreSQL BYTEA (Phase 4/8)</strong>
            </div>
          </div>
        </div>
      </div>

      {/* Create Page Dialog */}
      <Dialog
        isOpen={isCreatePageOpen}
        onClose={() => setIsCreatePageOpen(false)}
        title="Create New Page"
        description="Add a new collaborative page to your workspace."
        footer={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setIsCreatePageOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={!newPageTitle.trim()}
              onClick={handleCreatePage}
            >
              Create Page
            </Button>
          </>
        }
      >
        <form onSubmit={handleCreatePage} className="space-y-4">
          <Input
            id="dash-new-page-title"
            label="Page Title"
            placeholder="e.g. Architecture Decisions, Feature Roadmap"
            value={newPageTitle}
            onChange={(e) => setNewPageTitle(e.target.value)}
            autoFocus
          />
        </form>
      </Dialog>

      {/* Create Workspace Dialog */}
      <Dialog
        isOpen={isCreateWsOpen}
        onClose={() => setIsCreateWsOpen(false)}
        title="Create New Workspace"
        description="Workspaces let you collaborate across different teams and projects."
        footer={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setIsCreateWsOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={!newWsName.trim()}
              onClick={handleCreateWorkspace}
            >
              Create Workspace
            </Button>
          </>
        }
      >
        <form onSubmit={handleCreateWorkspace} className="space-y-4">
          <Input
            id="dash-new-ws-name"
            label="Workspace Name"
            placeholder="e.g. Product Engineering, Marketing Hub"
            value={newWsName}
            onChange={(e) => setNewWsName(e.target.value)}
            autoFocus
          />
        </form>
      </Dialog>
    </AppShell>
  );
}
