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
      <div className="space-y-8">
        {/* Welcome Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 border-b border-[#e9e9e7]">
          <div>
            <h1 className="text-2xl font-bold text-[#37352f] tracking-tight">
              Good day, {user?.name || "Collaborator"}
            </h1>
            <p className="text-sm text-neutral-500 mt-1">
              Select or create a collaborative workspace to manage your documents.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              onClick={() => setIsCreateOpen(true)}
            >
              <Plus className="w-4 h-4 mr-1.5" />
              <span>New Workspace</span>
            </Button>
          </div>
        </div>

        {errorMessage && (
          <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 text-xs text-red-700 rounded-lg">
            <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Quick Search */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              type="text"
              placeholder="Filter your workspaces..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm bg-[#fafafa] border border-[#e5e7eb] rounded-md text-[#37352f] placeholder:text-neutral-400 focus:outline-none focus:bg-white focus:border-[#2383e2] transition-colors"
            />
          </div>
          <Button
            variant="outline"
            className="text-xs"
            onClick={() => setIsCreateOpen(true)}
          >
            <FolderPlus className="w-3.5 h-3.5 mr-1.5 text-neutral-500" />
            <span>Create Workspace</span>
          </Button>
        </div>

        {/* Workspaces List Section */}
        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs font-semibold text-neutral-500 uppercase tracking-wider">
            <span className="flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5" />
              <span>Your Workspaces</span>
            </span>
            <span className="text-neutral-400 text-[11px] font-normal normal-case">
              {filteredWorkspaces.length}{" "}
              {filteredWorkspaces.length === 1 ? "workspace" : "workspaces"}
            </span>
          </div>

          {/* Loading Skeleton State */}
          {isLoading ? (
            <div className="grid gap-3">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="p-4 bg-white border border-[#e9e9e7] rounded-xl flex items-center justify-between animate-pulse"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-[#efefed]" />
                    <div className="space-y-1.5">
                      <div className="h-4 w-40 bg-[#efefed] rounded" />
                      <div className="h-3 w-24 bg-[#efefed] rounded" />
                    </div>
                  </div>
                  <div className="h-8 w-24 bg-[#efefed] rounded" />
                </div>
              ))}
            </div>
          ) : workspaces.length === 0 ? (
            /* Empty State */
            <div className="p-12 border border-dashed border-[#e5e7eb] rounded-xl bg-[#fafafa]/50 text-center space-y-4">
              <div className="w-12 h-12 rounded-full bg-blue-50 text-[#2383e2] flex items-center justify-center mx-auto">
                <Building2 className="w-6 h-6" />
              </div>
              <div className="space-y-1 max-w-sm mx-auto">
                <h3 className="text-sm font-semibold text-[#37352f]">
                  No workspaces yet
                </h3>
                <p className="text-xs text-neutral-500 leading-relaxed">
                  Create your first collaborative workspace to start organizing documents and collaborating in real time.
                </p>
              </div>
              <Button
                variant="primary"
                size="sm"
                onClick={() => setIsCreateOpen(true)}
              >
                <Plus className="w-3.5 h-3.5 mr-1" />
                <span>Create Workspace</span>
              </Button>
            </div>
          ) : filteredWorkspaces.length === 0 ? (
            /* Search Empty State */
            <div className="p-8 border border-[#e9e9e7] rounded-xl bg-white text-center space-y-2">
              <p className="text-sm font-medium text-[#37352f]">
                No workspaces matching &ldquo;{searchQuery}&rdquo;
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
            <div className="grid gap-3">
              {filteredWorkspaces.map((ws) => (
                <div
                  key={ws.id}
                  className="p-4 bg-white border border-[#e9e9e7] hover:border-[#d0d0ce] rounded-xl transition-all shadow-2xs hover:shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-10 h-10 rounded-lg bg-[#2383e2] text-white flex items-center justify-center font-bold text-sm shrink-0">
                      {ws.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/workspace/${ws.id}`}
                          className="text-sm font-semibold text-[#37352f] hover:text-[#2383e2] transition-colors truncate"
                        >
                          {ws.name}
                        </Link>
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-blue-50 text-[#2383e2] border border-blue-200 shrink-0">
                          {ws.role}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-neutral-400 mt-1">
                        <span className="flex items-center gap-1">
                          <Users className="w-3 h-3 text-neutral-400" />
                          <span>
                            {ws.membersCount} Member{ws.membersCount === 1 ? "" : "s"}
                          </span>
                        </span>
                        <span>•</span>
                        <span className="flex items-center gap-1">
                          <FileText className="w-3 h-3 text-neutral-400" />
                          <span>
                            {ws.pagesCount} Page{ws.pagesCount === 1 ? "" : "s"}
                          </span>
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                    {ws.isOwner && (
                      <>
                        <button
                          onClick={() => {
                            setActiveWs(ws);
                            setRenameValue(ws.name);
                            setIsRenameOpen(true);
                          }}
                          className="p-1.5 rounded-md text-neutral-400 hover:text-neutral-700 hover:bg-[#efefed] transition-colors cursor-pointer"
                          title="Rename workspace"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => {
                            setActiveWs(ws);
                            setIsDeleteOpen(true);
                          }}
                          className="p-1.5 rounded-md text-neutral-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                          title="Delete workspace"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}

                    <Link href={`/workspace/${ws.id}`}>
                      <Button variant="secondary" size="sm" className="text-xs">
                        <span>Open</span>
                        <ChevronRight className="w-3.5 h-3.5 ml-1" />
                      </Button>
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
        title="Create New Workspace"
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
                "Create Workspace"
              )}
            </Button>
          </>
        }
      >
        <form onSubmit={handleCreate} className="space-y-4">
          <Input
            id="dash-create-ws-name"
            label="Workspace Name"
            placeholder="e.g. Engineering Team, Sprint 2026"
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
                "Save Changes"
              )}
            </Button>
          </>
        }
      >
        <form onSubmit={handleRename} className="space-y-4">
          <Input
            id="dash-rename-ws-name"
            label="Workspace Name"
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
        description={`Are you sure you want to permanently delete "${activeWs?.name}"? All associated pages and member records will be deleted. This action cannot be undone.`}
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
                "Confirm Delete"
              )}
            </Button>
          </>
        }
      >
        <p className="text-xs text-red-600">
          This operation is permanent. Only workspace owners can delete this workspace.
        </p>
      </Dialog>
    </AppShell>
  );
}
