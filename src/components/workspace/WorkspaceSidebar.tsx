"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Search,
  LayoutDashboard,
  Settings,
  PanelLeftClose,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { PageTree } from "./PageTree";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";

interface WorkspaceSidebarProps {
  workspaceId?: string;
  isOpen: boolean;
  onClose?: () => void;
  onWorkspaceChange?: (workspaceId: string) => void;
}

export function WorkspaceSidebar({
  workspaceId = "ws-main",
  isOpen,
  onClose,
  onWorkspaceChange,
}: WorkspaceSidebarProps) {
  const pathname = usePathname();
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Register global Ctrl+K / Cmd+K keyboard shortcut listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsSearchOpen((prev) => !prev);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <>
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 w-64 bg-[#fbfbfa] border-r border-[#e9e9e7] flex flex-col transition-transform duration-200 ease-in-out md:static md:translate-x-0 select-none",
          isOpen ? "translate-x-0 shadow-lg md:shadow-none" : "-translate-x-full md:translate-x-0"
        )}
      >
        {/* Workspace Switcher Header */}
        <div className="p-2.5 sm:p-3 border-b border-[#e9e9e7]/70 flex items-center justify-between">
          <WorkspaceSwitcher
            currentWorkspaceId={workspaceId}
            onWorkspaceChange={onWorkspaceChange}
          />

          {/* Mobile close button */}
          <button
            onClick={onClose}
            className="md:hidden p-1.5 rounded-md text-neutral-400 hover:text-neutral-700 hover:bg-[#efefed] ml-1 shrink-0 transition-colors"
            aria-label="Close sidebar"
          >
            <PanelLeftClose className="w-4 h-4" />
          </button>
        </div>

        {/* Quick Search & Actions */}
        <div className="p-2 space-y-1">
          <button
            onClick={() => setIsSearchOpen(true)}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-neutral-500 hover:text-neutral-800 hover:bg-[#efefed] rounded-md transition-colors group cursor-pointer"
            title="Search documents (Ctrl+K or Cmd+K)"
          >
            <Search className="w-3.5 h-3.5 text-neutral-400 group-hover:text-neutral-600 transition-colors" />
            <span className="flex-1 text-left">Search pages...</span>
            <kbd className="text-[10px] bg-white border border-[#e5e7eb] px-1.5 py-0.5 rounded text-neutral-400 font-mono shadow-2xs">
              Ctrl+K
            </kbd>
          </button>

          <Link
            href="/dashboard"
            className={cn(
              "w-full flex items-center gap-2 px-2.5 py-1.5 text-xs rounded-md transition-colors",
              pathname === "/dashboard"
                ? "bg-[#efefed] text-[#37352f] font-medium"
                : "text-neutral-600 hover:bg-[#efefed] hover:text-[#37352f]"
            )}
          >
            <LayoutDashboard className="w-3.5 h-3.5 text-neutral-500" />
            <span>Dashboard</span>
          </Link>
        </div>

        {/* Page Tree Navigation */}
        <div className="flex-1 overflow-y-auto px-2 py-1 space-y-1">
          <PageTree workspaceId={workspaceId} />
        </div>

        {/* Footer Profile & Settings */}
        <div className="p-2.5 sm:p-3 border-t border-[#e9e9e7]/70 bg-[#fbfbfa]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-6 h-6 rounded-full bg-neutral-200 border border-neutral-300 flex items-center justify-center text-xs font-medium text-neutral-700 shrink-0">
                U
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-xs font-medium text-[#37352f] truncate leading-tight">
                  Intern Engineer
                </span>
                <span className="text-[10px] text-neutral-400 font-mono leading-none mt-0.5">
                  Role: Owner
                </span>
              </div>
            </div>
            <Link
              href="/dashboard"
              className="p-1.5 rounded-md text-neutral-400 hover:text-neutral-700 hover:bg-[#efefed] transition-colors"
              title="Settings"
            >
              <Settings className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </aside>

      {/* Quick Search Dialog */}
      <Dialog
        isOpen={isSearchOpen}
        onClose={() => {
          setIsSearchOpen(false);
          setSearchQuery("");
        }}
        title="Search Documents"
        description="Quickly find pages in the current workspace."
      >
        <div className="space-y-4">
          <Input
            id="quick-search-input"
            placeholder="Type page title to search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoFocus
          />

          <div className="space-y-1">
            <span className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
              Quick Links
            </span>
            <div className="space-y-1">
              {[
                { id: "getting-started", title: "Getting Started", icon: "🚀" },
                { id: "quickstart", title: "Quickstart Guide", icon: "⚡" },
                { id: "architecture-overview", title: "Architecture Blueprint", icon: "📐" },
                { id: "project-spec", title: "Project Blueprint", icon: "📚" },
                { id: "crdt-spec", title: "CRDT & Yjs Synchronization", icon: "🔄" },
                { id: "schema-spec", title: "PostgreSQL Data Models", icon: "🗄️" },
                { id: "meeting-notes", title: "Engineering Sync", icon: "📝" },
                { id: "sprint-roadmap", title: "Sprint Goals & Milestones", icon: "🎯" },
              ]
                .filter((item) =>
                  item.title.toLowerCase().includes(searchQuery.toLowerCase())
                )
                .map((item) => (
                  <Link
                    key={item.id}
                    href={`/workspace/${workspaceId}?page=${item.id}`}
                    onClick={() => {
                      setIsSearchOpen(false);
                      setSearchQuery("");
                    }}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-md hover:bg-[#f7f7f5] text-xs text-[#37352f] transition-colors"
                  >
                    <span className="text-sm shrink-0">{item.icon}</span>
                    <span className="font-medium flex-1 truncate">{item.title}</span>
                  </Link>
                ))}
            </div>
          </div>
        </div>
      </Dialog>
    </>
  );
}
