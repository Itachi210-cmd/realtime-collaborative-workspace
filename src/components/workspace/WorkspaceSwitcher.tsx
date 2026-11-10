"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronDown,
  Plus,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import {
  WorkspaceSummary,
  getWorkspaces,
  createWorkspace,
} from "@/lib/api/workspaces";

interface WorkspaceSwitcherProps {
  currentWorkspaceId?: string;
  onWorkspaceChange?: (workspaceId: string, role?: string) => void;
}

export function WorkspaceSwitcher({
  currentWorkspaceId = "",
  onWorkspaceChange,
}: WorkspaceSwitcherProps) {
  const router = useRouter();
  const { addToast } = useToast();
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string>(currentWorkspaceId);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    let isMounted = true;
    getWorkspaces()
      .then((list) => {
        if (isMounted) {
          setWorkspaces(list);
          if (list.length > 0) {
            const savedId =
              typeof window !== "undefined"
                ? localStorage.getItem("collab-active-workspace-id")
                : null;
            const target =
              list.find((w) => w.id === (currentWorkspaceId || savedId)) || list[0];
            setSelectedId(target.id);
            if (!currentWorkspaceId) {
              onWorkspaceChange?.(target.id, target.role);
            }
          }
          setIsLoading(false);
        }
      })
      .catch(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [currentWorkspaceId, onWorkspaceChange]);

  const activeId = currentWorkspaceId || selectedId;
  const currentWorkspace =
    workspaces.find((w) => w.id === activeId) || workspaces[0];

  const handleSelectWorkspace = (ws: WorkspaceSummary) => {
    setSelectedId(ws.id);
    setIsDropdownOpen(false);
    try {
      localStorage.setItem("collab-active-workspace-id", ws.id);
    } catch {}
    onWorkspaceChange?.(ws.id, ws.role);
    router.push(`/workspace/${ws.id}`);
    addToast({
      message: `Switched to ${ws.name}`,
      description: `Role: ${ws.role} • ${ws.membersCount} member${ws.membersCount === 1 ? "" : "s"}`,
      variant: "info",
    });
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWorkspaceName.trim() || isCreating) return;

    setIsCreating(true);
    try {
      const newWs = await createWorkspace(newWorkspaceName.trim());
      setWorkspaces((prev) => [newWs, ...prev]);
      setSelectedId(newWs.id);
      setIsCreateModalOpen(false);
      setNewWorkspaceName("");
      try {
        localStorage.setItem("collab-active-workspace-id", newWs.id);
      } catch {}
      onWorkspaceChange?.(newWs.id, newWs.role);
      router.push(`/workspace/${newWs.id}`);

      addToast({
        message: `Workspace "${newWs.name}" created`,
        description: "You have Owner privileges in this new workspace.",
        variant: "success",
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to create workspace";
      addToast({
        message: "Error creating workspace",
        description: msg,
        variant: "error",
      });
    } finally {
      setIsCreating(false);
    }
  };

  const avatarLetter = currentWorkspace
    ? currentWorkspace.name.trim().charAt(0).toUpperCase()
    : "W";

  return (
    <div className="relative w-full">
      {/* Switcher Header Pill */}
      <button
        onClick={() => setIsDropdownOpen(!isDropdownOpen)}
        className="flex items-center gap-2.5 px-2 py-1.5 rounded-md hover:bg-[var(--bg-hover)] text-left cursor-pointer transition-colors w-full border border-transparent hover:border-[var(--border-subtle)]"
        aria-haspopup="true"
        aria-expanded={isDropdownOpen}
      >
        <div className="w-6 h-6 rounded-md bg-[var(--accent-light)] text-[var(--accent)] border border-[var(--accent-border)]/40 flex items-center justify-center text-xs font-semibold shrink-0">
          {avatarLetter}
        </div>
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-xs font-medium text-[var(--text-primary)] truncate leading-tight">
            {isLoading
              ? "Loading workspaces..."
              : currentWorkspace?.name || "Select Workspace"}
          </span>
          <span className="text-[10px] text-[var(--text-faint)] truncate leading-none mt-0.5">
            {currentWorkspace
              ? `${currentWorkspace.role} • ${currentWorkspace.membersCount} Member${currentWorkspace.membersCount === 1 ? "" : "s"}`
              : "No workspace"}
          </span>
        </div>
        <ChevronDown className="w-3.5 h-3.5 text-[var(--text-faint)] shrink-0 ml-1" />
      </button>

      {/* Dropdown Menu */}
      {isDropdownOpen && (
        <>
          <div
            className="fixed inset-0 z-30"
            onClick={() => setIsDropdownOpen(false)}
          />
          <div className="absolute top-full left-0 mt-1.5 w-64 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg shadow-md z-40 p-1 text-xs text-[var(--text-primary)] animate-in fade-in-50 duration-100">
            <div className="px-2.5 py-1.5 text-[11px] font-medium text-[var(--text-muted)]">
              Workspaces
            </div>

            <div className="space-y-0.5 max-h-60 overflow-y-auto">
              {workspaces.map((ws) => {
                const isSelected = ws.id === selectedId;
                const wsLetter = ws.name.trim().charAt(0).toUpperCase();

                return (
                  <button
                    key={ws.id}
                    onClick={() => handleSelectWorkspace(ws)}
                    className={cn(
                      "w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-md transition-colors text-left",
                      isSelected
                        ? "bg-[var(--bg-hover)] text-[var(--text-primary)]"
                        : "hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    )}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div
                        className={cn(
                          "w-5 h-5 rounded flex items-center justify-center text-[10px] font-semibold shrink-0 border",
                          isSelected
                            ? "bg-[var(--accent-light)] text-[var(--accent)] border-[var(--accent-border)]/40"
                            : "bg-[var(--bg-raised)] text-[var(--text-muted)] border-[var(--border-subtle)]"
                        )}
                      >
                        {wsLetter}
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="font-medium text-[var(--text-primary)] truncate">
                          {ws.name}
                        </span>
                        <span className="text-[10px] text-[var(--text-faint)]">
                          {ws.role} • {ws.membersCount} member{ws.membersCount === 1 ? "" : "s"}
                        </span>
                      </div>
                    </div>
                    {isSelected && (
                      <Check className="w-3.5 h-3.5 text-[var(--accent)] shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>

            <div className="pt-1 mt-1 border-t border-[var(--border-subtle)]">
              <button
                onClick={() => {
                  setIsDropdownOpen(false);
                  setIsCreateModalOpen(true);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
              >
                <Plus className="w-3.5 h-3.5 text-[var(--text-faint)]" />
                <span>Create workspace</span>
              </button>
            </div>
          </div>
        </>
      )}

      {/* Create Workspace Dialog */}
      <Dialog
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        title="Create New Workspace"
        description="Workspaces organize documents, pages, and collaborator access."
        footer={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setIsCreateModalOpen(false)}
              disabled={isCreating}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={!newWorkspaceName.trim() || isCreating}
              onClick={handleCreate}
            >
              {isCreating ? (
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
            id="ws-name-input"
            label="Workspace Name"
            placeholder="e.g. Mobile Engineering, Sprint Planning"
            value={newWorkspaceName}
            onChange={(e) => setNewWorkspaceName(e.target.value)}
            disabled={isCreating}
            autoFocus
          />
        </form>
      </Dialog>
    </div>
  );
}
