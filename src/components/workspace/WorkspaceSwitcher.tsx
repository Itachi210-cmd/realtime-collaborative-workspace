"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronDown,
  Plus,
} from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";

export interface WorkspaceItem {
  id: string;
  name: string;
  plan: string;
  membersCount: number;
  role: string;
  avatarLetter: string;
  color: string;
}

const DEFAULT_WORKSPACES: WorkspaceItem[] = [
  {
    id: "ws-main",
    name: "Engineering Workspace",
    plan: "Free Plan",
    membersCount: 4,
    role: "Owner",
    avatarLetter: "E",
    color: "bg-[#2383e2]",
  },
  {
    id: "ws-design",
    name: "Product & Design",
    plan: "Free Plan",
    membersCount: 8,
    role: "Editor",
    avatarLetter: "P",
    color: "bg-purple-600",
  },
  {
    id: "ws-notes",
    name: "Internship Notes",
    plan: "Personal",
    membersCount: 1,
    role: "Owner",
    avatarLetter: "I",
    color: "bg-emerald-600",
  },
];

interface WorkspaceSwitcherProps {
  currentWorkspaceId?: string;
  onWorkspaceChange?: (workspaceId: string) => void;
}

export function WorkspaceSwitcher({
  currentWorkspaceId = "ws-main",
  onWorkspaceChange,
}: WorkspaceSwitcherProps) {
  const router = useRouter();
  const { addToast } = useToast();
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>(DEFAULT_WORKSPACES);
  const [selectedId, setSelectedId] = useState<string>(currentWorkspaceId);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState("");

  const currentWorkspace =
    workspaces.find((w) => w.id === selectedId) || workspaces[0];

  const handleSelectWorkspace = (ws: WorkspaceItem) => {
    setSelectedId(ws.id);
    setIsDropdownOpen(false);
    onWorkspaceChange?.(ws.id);
    router.push(`/workspace/${ws.id}`);
    addToast({
      message: `Switched to ${ws.name}`,
      description: `Role: ${ws.role} • ${ws.membersCount} collaborators`,
      variant: "info",
    });
  };

  const handleCreateWorkspace = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWorkspaceName.trim()) return;

    const newWs: WorkspaceItem = {
      id: `ws-${Date.now().toString().slice(-4)}`,
      name: newWorkspaceName.trim(),
      plan: "Free Plan",
      membersCount: 1,
      role: "Owner",
      avatarLetter: newWorkspaceName.trim().charAt(0).toUpperCase(),
      color: "bg-indigo-600",
    };

    setWorkspaces((prev) => [...prev, newWs]);
    setSelectedId(newWs.id);
    setIsCreateModalOpen(false);
    setNewWorkspaceName("");
    router.push(`/workspace/${newWs.id}`);

    addToast({
      message: `Workspace "${newWs.name}" created`,
      description: "You have Owner privileges in this new workspace.",
      variant: "success",
    });
  };

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
          className={`w-6 h-6 rounded-md ${currentWorkspace.color} text-white flex items-center justify-center text-xs font-semibold shrink-0`}
        >
          {currentWorkspace.avatarLetter}
        </div>
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-xs font-semibold text-[#37352f] truncate leading-tight">
            {currentWorkspace.name}
          </span>
          <span className="text-[10px] text-neutral-400 truncate leading-none mt-0.5">
            {currentWorkspace.plan} • {currentWorkspace.membersCount} Members
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

            <div className="space-y-0.5">
              {workspaces.map((ws) => {
                const isSelected = ws.id === selectedId;
                return (
                  <button
                    key={ws.id}
                    onClick={() => handleSelectWorkspace(ws)}
                    className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg hover:bg-[#f7f7f5] transition-colors text-left"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div
                        className={`w-5 h-5 rounded ${ws.color} text-white flex items-center justify-center text-[11px] font-semibold shrink-0`}
                      >
                        {ws.avatarLetter}
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="font-medium text-[#37352f] truncate">
                          {ws.name}
                        </span>
                        <span className="text-[10px] text-neutral-400">
                          {ws.role} • {ws.membersCount} members
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
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={!newWorkspaceName.trim()}
              onClick={handleCreateWorkspace}
            >
              Create Workspace
            </Button>
          </>
        }
      >
        <form onSubmit={handleCreateWorkspace} className="space-y-4">
          <Input
            id="ws-name-input"
            label="Workspace Name"
            placeholder="e.g. Mobile Engineering, Sprint Planning"
            value={newWorkspaceName}
            onChange={(e) => setNewWorkspaceName(e.target.value)}
            autoFocus
          />
          <div className="p-3 bg-[#fafafa] border border-[#e5e7eb] rounded-md text-xs text-neutral-500 space-y-1">
            <span className="font-semibold text-neutral-700 block">
              Phase 2 Mock State:
            </span>
            <p>
              New workspaces persist in client memory during your session. Database persistence will be connected in Phase 4 via PostgreSQL and Prisma.
            </p>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
