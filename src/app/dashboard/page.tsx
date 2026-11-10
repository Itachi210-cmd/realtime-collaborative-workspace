"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Plus,
  FolderPlus,
  Search,
  ChevronRight,
  Edit2,
  Trash2,
  Users,
  FileText,
  Loader2,
  AlertCircle,
  Building2,
  X,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { useCurrentUser } from "@/lib/auth/useCurrentUser";
import {
  WorkspaceSummary,
  getWorkspaces,
  createWorkspace,
  renameWorkspace,
  deleteWorkspace,
} from "@/lib/api/workspaces";

export default function DashboardPage() {
  const router = useRouter();
  const { user } = useCurrentUser();
  const { addToast } = useToast();

  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Dialog states
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newWsName, setNewWsName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [activeWs, setActiveWs] = useState<WorkspaceSummary | null>(null);
  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");

  const [isDeleteOpen, setIsDeleteOpen] = useState(false);

  useEffect(() => {
    let isMounted = true;
    getWorkspaces()
      .then((data) => {
        if (isMounted) {
          setWorkspaces(data);
          setIsLoading(false);
        }
      })
      .catch(() => {
        if (isMounted) {
          setErrorMessage("Could not load workspaces. Please check your connection.");
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const filteredWorkspaces = workspaces.filter((ws) =>
    ws.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newWsName.trim();
    if (!trimmed || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const created = await createWorkspace(trimmed);
      setWorkspaces((prev) => [created, ...prev]);
      setIsCreateOpen(false);
      setNewWsName("");

      addToast({
        message: "Workspace created",
        description: `"${created.name}" is ready for collaboration.`,
        variant: "success",
      });

      router.push(`/workspace/${created.id}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to create workspace";
      addToast({
        message: "Error creating workspace",
        description: msg,
        variant: "error",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeWs || !renameValue.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await renameWorkspace(activeWs.id, renameValue.trim());
      setWorkspaces((prev) =>
        prev.map((w) =>
          w.id === activeWs.id ? { ...w, name: renameValue.trim() } : w
        )
      );
      setIsRenameOpen(false);
      addToast({
        message: "Workspace renamed",
        description: `Renamed to "${renameValue.trim()}"`,
        variant: "success",
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to rename workspace";
      addToast({
        message: "Error renaming workspace",
        description: msg,
        variant: "error",
      });
    } finally {
      setIsSubmitting(false);
      setActiveWs(null);
    }
  };

  const handleDelete = async () => {
    if (!activeWs || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await deleteWorkspace(activeWs.id);
      setWorkspaces((prev) => prev.filter((w) => w.id !== activeWs.id));
      setIsDeleteOpen(false);
      addToast({
        message: "Workspace deleted",
        description: `Workspace "${activeWs.name}" has been removed.`,
        variant: "info",
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to delete workspace";
      addToast({
        message: "Error deleting workspace",
        description: msg,
        variant: "error",
      });
    } finally {
      setIsSubmitting(false);
      setActiveWs(null);
    }
  };

  return (
    <AppShell pageTitle="Dashboard">
      <div className="space-y-6 max-w-5xl mx-auto">
        {/* Editorial Welcome Header */}
        <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-4 pb-5 border-b border-[var(--border-subtle)]">
          <div>
            <h1 className="text-2xl sm:text-3xl font-serif font-normal text-[var(--text-primary)] tracking-tight">
              Welcome back, {user?.name || "Collaborator"}
            </h1>
            <p className="text-xs sm:text-sm text-[var(--text-muted)] mt-1">
              Select or create a workspace to draft, organize, and edit documents in real time.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              onClick={() => setIsCreateOpen(true)}
              className="gap-1.5 shadow-2xs"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create workspace</span>
            </Button>
          </div>
        </div>

        {errorMessage && (
          <div className="flex items-center gap-2.5 p-3 bg-red-500/10 border border-red-500/20 text-xs text-red-600 dark:text-red-400 rounded-md">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Refined Search & Stats Bar */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
            <input
              type="text"
              placeholder="Search workspaces..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-8 py-1.5 text-xs bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-md text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--accent)] transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-faint)] hover:text-[var(--text-primary)]"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          <div className="text-[11px] font-mono text-[var(--text-faint)] flex items-center gap-1.5 self-end sm:self-center">
            <Building2 className="w-3.5 h-3.5 text-[var(--text-muted)]" />
            <span>
              {filteredWorkspaces.length}{" "}
              {filteredWorkspaces.length === 1 ? "workspace" : "workspaces"}
            </span>
          </div>
        </div>

        {/* Workspaces Collection */}
        <div>
          {/* Loading Skeleton */}
          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="p-4 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg space-y-3 animate-pulse"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-md bg-[var(--bg-hover)]" />
                    <div className="space-y-1 flex-1">
                      <div className="h-3.5 w-3/4 bg-[var(--bg-hover)] rounded" />
                      <div className="h-2.5 w-1/3 bg-[var(--bg-hover)] rounded" />
                    </div>
                  </div>
                  <div className="h-6 w-full bg-[var(--bg-hover)] rounded" />
                </div>
              ))}
            </div>
          ) : workspaces.length === 0 ? (
            /* Inviting Editorial Empty State */
            <div className="py-14 px-6 border border-dashed border-[var(--border-subtle)] rounded-lg bg-[var(--bg-surface)] text-center space-y-4">
              <div className="w-10 h-10 rounded-md bg-[var(--accent-light)] text-[var(--accent)] flex items-center justify-center mx-auto border border-[var(--accent-border)]/40">
                <FolderPlus className="w-5 h-5" />
              </div>
              <div className="space-y-1.5 max-w-sm mx-auto">
                <h3 className="text-base font-serif font-normal text-[var(--text-primary)]">
                  No workspaces yet
                </h3>
                <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                  Create your first collaborative workspace to start drafting documents and editing together in real time.
                </p>
              </div>
              <Button
                variant="primary"
                size="sm"
                onClick={() => setIsCreateOpen(true)}
                className="gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Create workspace</span>
              </Button>
            </div>
          ) : filteredWorkspaces.length === 0 ? (
            /* Search Filter Empty State */
            <div className="p-8 border border-[var(--border-subtle)] rounded-lg bg-[var(--bg-surface)] text-center space-y-2">
              <p className="text-xs text-[var(--text-muted)]">
                No workspaces matching &ldquo;{searchQuery}&rdquo;
              </p>
              <button
                onClick={() => setSearchQuery("")}
                className="text-xs text-[var(--accent)] hover:underline"
              >
                Clear search filter
              </button>
            </div>
          ) : (
            /* Refined Workspace Grid */
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {filteredWorkspaces.map((ws) => (
                <div
                  key={ws.id}
                  className="group relative p-4 bg-[var(--bg-surface)] border border-[var(--border-subtle)] hover:border-[var(--border-strong)] rounded-lg transition-all shadow-2xs hover:shadow-xs flex flex-col justify-between gap-4"
                >
                  <div className="space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-md bg-[var(--accent-light)] text-[var(--accent)] border border-[var(--accent-border)]/40 flex items-center justify-center font-mono text-xs font-semibold shrink-0">
                          {ws.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <Link
                            href={`/workspace/${ws.id}`}
                            className="text-sm font-medium text-[var(--text-primary)] hover:text-[var(--accent)] transition-colors truncate block"
                          >
                            {ws.name}
                          </Link>
                          <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-[var(--bg-raised)] text-[var(--text-muted)] border border-[var(--border-subtle)] inline-block mt-0.5">
                            {ws.role}
                          </span>
                        </div>
                      </div>

                      {ws.isOwner && (
                        <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => {
                              setActiveWs(ws);
                              setRenameValue(ws.name);
                              setIsRenameOpen(true);
                            }}
                            className="p-1 rounded text-[var(--text-faint)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
                            title="Rename workspace"
                          >
                            <Edit2 className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => {
                              setActiveWs(ws);
                              setIsDeleteOpen(true);
                            }}
                            className="p-1 rounded text-[var(--text-faint)] hover:text-red-500 hover:bg-red-500/10 transition-colors cursor-pointer"
                            title="Delete workspace"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-3 text-[11px] font-mono text-[var(--text-faint)] pt-1">
                      <span className="flex items-center gap-1">
                        <Users className="w-3 h-3 text-[var(--text-muted)]" />
                        <span>
                          {ws.membersCount} {ws.membersCount === 1 ? "member" : "members"}
                        </span>
                      </span>
                      <span>•</span>
                      <span className="flex items-center gap-1">
                        <FileText className="w-3 h-3 text-[var(--text-muted)]" />
                        <span>
                          {ws.pagesCount} {ws.pagesCount === 1 ? "document" : "documents"}
                        </span>
                      </span>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-[var(--border-subtle)]/70 flex items-center justify-end">
                    <Link
                      href={`/workspace/${ws.id}`}
                      className="text-xs font-medium text-[var(--text-muted)] group-hover:text-[var(--accent)] flex items-center gap-1 transition-colors"
                    >
                      <span>Open workspace</span>
                      <ChevronRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Create Workspace Dialog */}
      <Dialog
        isOpen={isCreateOpen}
        onClose={() => !isSubmitting && setIsCreateOpen(false)}
        title="Create Workspace"
        description="Organize documents and invite collaborators to your space."
        footer={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setIsCreateOpen(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={!newWsName.trim() || isSubmitting}
              onClick={handleCreate}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  <span>Creating...</span>
                </>
              ) : (
                "Create workspace"
              )}
            </Button>
          </>
        }
      >
        <form onSubmit={handleCreate} className="space-y-4">
          <Input
            id="dash-create-ws-name"
            label="Workspace name"
            placeholder="e.g. Editorial Board, Architecture Team"
            value={newWsName}
            onChange={(e) => setNewWsName(e.target.value)}
            disabled={isSubmitting}
            autoFocus
          />
        </form>
      </Dialog>

      {/* Rename Workspace Dialog */}
      <Dialog
        isOpen={isRenameOpen}
        onClose={() => !isSubmitting && setIsRenameOpen(false)}
        title="Rename Workspace"
        description={`Enter a new name for "${activeWs?.name}".`}
        footer={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setIsRenameOpen(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={!renameValue.trim() || isSubmitting}
              onClick={handleRename}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                "Save changes"
              )}
            </Button>
          </>
        }
      >
        <form onSubmit={handleRename} className="space-y-4">
          <Input
            id="dash-rename-ws-name"
            label="Workspace name"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            disabled={isSubmitting}
            autoFocus
          />
        </form>
      </Dialog>

      {/* Delete Workspace Confirmation Dialog */}
      <Dialog
        isOpen={isDeleteOpen}
        onClose={() => !isSubmitting && setIsDeleteOpen(false)}
        title="Delete Workspace"
        description={`Are you sure you want to permanently delete "${activeWs?.name}"? All associated documents and member records will be permanently removed.`}
        footer={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setIsDeleteOpen(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={handleDelete}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  <span>Deleting...</span>
                </>
              ) : (
                "Delete workspace"
              )}
            </Button>
          </>
        }
      >
        <p className="text-xs text-red-600 dark:text-red-400">
          This operation is permanent and cannot be undone. Only workspace owners have permission to delete this space.
        </p>
      </Dialog>
    </AppShell>
  );
}
