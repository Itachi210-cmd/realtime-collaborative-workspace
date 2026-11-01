"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronDown,
  Plus,
  Loader2,
} from "lucide-react";
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
  onWorkspaceChange?: (workspaceId: string) => void;
}

const AVATAR_COLORS = [
  "bg-[#2383e2]",
  "bg-purple-600",
  "bg-emerald-600",
  "bg-amber-600",
  "bg-rose-600",
  "bg-indigo-600",
];

function getColorForId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash << 5) - hash + id.charCodeAt(i);
  }
  const index = Math.abs(hash) % AVATAR_COLORS.length;
  return AVATAR_COLORS[index];
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
          if (list.length > 0 && !currentWorkspaceId) {
            setSelectedId(list[0].id);
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
  }, [currentWorkspaceId]);

  const activeId = currentWorkspaceId || selectedId;
  const currentWorkspace =
    workspaces.find((w) => w.id === activeId) || workspaces[0];

  const handleSelectWorkspace = (ws: WorkspaceSummary) => {
    setSelectedId(ws.id);
    setIsDropdownOpen(false);
    onWorkspaceChange?.(ws.id);
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
  const avatarColor = currentWorkspace
    ? getColorForId(currentWorkspace.id)
    : "bg-[#2383e2]";

  return (
    <div className="relative w-full">
      {/* Switcher Header Pill */}
      <button
        onClick={() => setIsDropdownOpen(!isDropdownOpen)}
        className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-[#efefed] text-left cursor-pointer transition-colors w-full border border-transparent hover:border-[#e9e9e7]"
        aria-haspopup="true"
        aria-expanded={isDropdownOpen}
      >
        <div
          className={`w-6 h-6 rounded-md ${avatarColor} text-white flex items-center justify-center text-xs font-semibold shrink-0`}
        >
          {avatarLetter}
        </div>
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-xs font-semibold text-[#37352f] truncate leading-tight">
            {isLoading
              ? "Loading workspaces..."
              : currentWorkspace?.name || "Select Workspace"}
          </span>
          <span className="text-[10px] text-neutral-400 truncate leading-none mt-0.5">
            {currentWorkspace
              ? `${currentWorkspace.role} • ${currentWorkspace.membersCount} Member${currentWorkspace.membersCount === 1 ? "" : "s"}`
              : "No workspace"}
          </span>
        </div>
        <ChevronDown className="w-3.5 h-3.5 text-neutral-400 shrink-0 ml-1" />
      </button>

      {/* Dropdown Menu */}
      {isDropdownOpen && (
        <>
          <div
            className="fixed inset-0 z-30"
            onClick={() => setIsDropdownOpen(false)}
          />
          <div className="absolute top-full left-0 mt-1.5 w-64 bg-white border border-[#e5e7eb] rounded-xl shadow-lg z-40 p-1.5 text-xs text-[#37352f] animate-in fade-in-50 zoom-in-95 duration-100">
            <div className="px-2.5 py-1.5 text-[10px] font-semibold text-neutral-400 uppercase tracking-wider">
              Switch Workspace
            </div>

            <div className="space-y-0.5 max-h-60 overflow-y-auto">
              {workspaces.map((ws) => {
                const isSelected = ws.id === selectedId;
                const wsColor = getColorForId(ws.id);
                const wsLetter = ws.name.trim().charAt(0).toUpperCase();

                return (
                  <button
                    key={ws.id}
                    onClick={() => handleSelectWorkspace(ws)}
                    className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg hover:bg-[#f7f7f5] transition-colors text-left"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div
                        className={`w-5 h-5 rounded ${wsColor} text-white flex items-center justify-center text-[11px] font-semibold shrink-0`}
                      >
                        {wsLetter}
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="font-medium text-[#37352f] truncate">
                          {ws.name}
                        </span>
                        <span className="text-[10px] text-neutral-400">
                          {ws.role} • {ws.membersCount} member{ws.membersCount === 1 ? "" : "s"}
                        </span>
                      </div>
                    </div>
                    {isSelected && (
                      <Check className="w-3.5 h-3.5 text-[#2383e2] shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>

            <div className="pt-1.5 mt-1 border-t border-[#e9e9e7]">
              <button
                onClick={() => {
                  setIsDropdownOpen(false);
                  setIsCreateModalOpen(true);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-[#efefed] text-neutral-600 hover:text-[#37352f] transition-colors"
              >
                <Plus className="w-3.5 h-3.5 text-neutral-500" />
                <span>Create New Workspace</span>
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
