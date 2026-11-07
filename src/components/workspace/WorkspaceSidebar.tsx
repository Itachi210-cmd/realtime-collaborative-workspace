"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Search,
  LayoutDashboard,
  Settings,
  PanelLeftClose,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { PageTree } from "./PageTree";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { useCurrentUser } from "@/lib/auth/useCurrentUser";
import { PageItem, getWorkspacePages } from "@/lib/api/workspaces";

interface WorkspaceSidebarProps {
  workspaceId?: string;
  isOpen: boolean;
  onClose?: () => void;
  onWorkspaceChange?: (workspaceId: string) => void;
  userRole?: string;
}

export function WorkspaceSidebar({
  workspaceId = "ws-main",
  isOpen,
  onClose,
  onWorkspaceChange,
  userRole,
}: WorkspaceSidebarProps) {
  const pathname = usePathname();
  const { user, logout } = useCurrentUser();
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [pages, setPages] = useState<PageItem[]>([]);

  useEffect(() => {
    let isMounted = true;
    if (isSearchOpen && workspaceId) {
      getWorkspacePages(workspaceId)
        .then((data) => {
          if (isMounted) setPages(data);
        })
        .catch(() => {});
    }
    return () => {
      isMounted = false;
    };
  }, [isSearchOpen, workspaceId]);

  const userInitials = user?.name
    ? user.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "U";

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
          <PageTree workspaceId={workspaceId} userRole={userRole} />
        </div>

        {/* Footer Profile & Settings */}
        <div className="p-2.5 sm:p-3 border-t border-[#e9e9e7]/70 bg-[#fbfbfa]">
          <div className="flex items-center justify-between gap-1">
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              <div className="w-6 h-6 rounded-full bg-blue-100 border border-blue-200 flex items-center justify-center text-[10px] font-semibold text-blue-700 shrink-0">
                {userInitials}
              </div>
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-xs font-medium text-[#37352f] truncate leading-tight">
                  {user?.name || "Collaborator"}
                </span>
                <span className="text-[10px] text-neutral-400 truncate leading-none mt-0.5">
                  {user?.email || "owner@workspace.dev"}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-0.5 shrink-0">
              <Link
                href="/dashboard"
                className="p-1.5 rounded-md text-neutral-400 hover:text-neutral-700 hover:bg-[#efefed] transition-colors"
                title="Settings"
              >
                <Settings className="w-3.5 h-3.5" />
              </Link>
              <button
                onClick={logout}
                className="p-1.5 rounded-md text-neutral-400 hover:text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
                title="Sign Out"
                aria-label="Sign out"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
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
              Documents ({pages.length})
            </span>
            <div className="space-y-1 max-h-56 overflow-y-auto">
              {pages.length === 0 ? (
                <p className="text-xs text-neutral-400 py-2 text-center">
                  No documents in this workspace.
                </p>
              ) : (
                pages
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
                      <span className="text-sm shrink-0">📄</span>
                      <span className="font-medium flex-1 truncate">{item.title}</span>
                    </Link>
                  ))
              )}
            </div>
          </div>
        </div>
      </Dialog>
    </>
  );
}
