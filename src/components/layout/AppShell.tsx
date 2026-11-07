"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  Menu,
  Share2,
  Users,
  LogOut,
} from "lucide-react";
import { WorkspaceSidebar } from "@/components/workspace/WorkspaceSidebar";
import { Button } from "@/components/ui/Button";
import { useCurrentUser } from "@/lib/auth/useCurrentUser";
import { ShareDialog } from "@/components/sharing/ShareDialog";

interface AppShellProps {
  children: React.ReactNode;
  workspaceId?: string;
  pageTitle?: string;
  showSidebar?: boolean;
  userRole?: string;
}

export function AppShell({
  children,
  workspaceId = "ws-main",
  pageTitle = "Page",
  showSidebar = true,
  userRole,
}: AppShellProps) {
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [fetchedRole, setFetchedRole] = useState<string>("");
  const resolvedRole = userRole || fetchedRole || "VIEWER";
  const { user, logout } = useCurrentUser();

  useEffect(() => {
    if (userRole || !workspaceId) return;
    let isMounted = true;
    fetch(`/api/workspaces/${workspaceId}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (isMounted && data?.workspace?.userRole) {
          setFetchedRole(data.workspace.userRole);
        }
      })
      .catch(() => {});

    return () => {
      isMounted = false;
    };
  }, [workspaceId, userRole]);

  const userInitials = user?.name
    ? user.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "ME";

  return (
    <div className="flex h-screen w-full overflow-hidden bg-white text-[#37352f]">
      {/* Sidebar for desktop & mobile drawer */}
      {showSidebar && (
        <WorkspaceSidebar
          workspaceId={workspaceId}
          isOpen={isMobileSidebarOpen}
          onClose={() => setIsMobileSidebarOpen(false)}
          userRole={resolvedRole}
        />
      )}

      {/* Main Layout Area */}
      <div className="flex flex-col flex-1 min-w-0 h-full overflow-hidden">
        {/* Top Navigation Bar */}
        <header className="h-11 px-4 border-b border-[#e9e9e7] flex items-center justify-between bg-white shrink-0 select-none">
          <div className="flex items-center gap-2 min-w-0">
            {showSidebar && (
              <button
                onClick={() => setIsMobileSidebarOpen(!isMobileSidebarOpen)}
                className="md:hidden p-1.5 rounded hover:bg-[#efefed] text-neutral-500 transition-colors"
                aria-label="Toggle menu"
              >
                <Menu className="w-4 h-4" />
              </button>
            )}

            {/* Breadcrumbs */}
            <nav className="flex items-center gap-1.5 text-xs text-neutral-500">
              <Link
                href="/dashboard"
                className="hover:text-[#37352f] hover:underline truncate max-w-[120px]"
              >
                Workspace
              </Link>
              <span>/</span>
              <span className="text-[#37352f] font-medium truncate max-w-[180px]">
                {pageTitle}
              </span>
            </nav>
          </div>

          {/* Right Header Controls */}
          <div className="flex items-center gap-2">
            {/* Sync State Badge (Notion-style subtle indicator) */}
            <div className="hidden sm:flex items-center gap-1.5 px-2 py-0.5 text-xs text-neutral-500 border border-neutral-200 rounded bg-[#fbfbfa]">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
              <span className="text-[11px] font-medium text-neutral-600">Sync: Ready</span>
            </div>

            {/* Collaborators Avatar Row Placeholder */}
            <div className="hidden sm:flex items-center -space-x-1.5">
              <div
                className="w-6 h-6 rounded-full bg-blue-100 border border-white text-blue-700 flex items-center justify-center text-[10px] font-semibold"
                title={`Active User: ${user?.name || "You"} (Owner)`}
              >
                {userInitials}
              </div>
              <div
                className="w-6 h-6 rounded-full bg-neutral-100 border border-white text-neutral-500 flex items-center justify-center text-[10px]"
                title="Collaboration connects in Phase 6"
              >
                <Users className="w-3 h-3" />
              </div>
            </div>

            {/* Share / Role Button */}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setIsShareModalOpen(true)}
              className="hidden xs:inline-flex"
            >
              <Share2 className="w-3.5 h-3.5 text-neutral-500 mr-1" />
              <span>Share</span>
            </Button>

            {/* User Session / Auth Controls */}
            <div className="flex items-center gap-1 pl-2 border-l border-neutral-200">
              {user ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-neutral-600 font-medium hidden md:inline truncate max-w-[120px]">
                    {user.name}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={logout}
                    className="text-xs text-neutral-500 hover:text-red-600"
                    title="Sign Out"
                  >
                    <LogOut className="w-3.5 h-3.5 sm:mr-1" />
                    <span className="hidden sm:inline">Logout</span>
                  </Button>
                </div>
              ) : (
                <>
                  <Link href="/login">
                    <Button variant="ghost" size="sm" className="text-xs">
                      Login
                    </Button>
                  </Link>
                  <Link href="/signup">
                    <Button variant="primary" size="sm" className="text-xs">
                      Signup
                    </Button>
                  </Link>
                </>
              )}
            </div>
          </div>
        </header>

        {/* Content Body */}
        <main className="flex-1 overflow-y-auto bg-white p-4 sm:p-8">
          <div className="max-w-4xl mx-auto w-full">{children}</div>
        </main>
      </div>

      {/* Backdrop for mobile drawer */}
      {isMobileSidebarOpen && (
        <div
          onClick={() => setIsMobileSidebarOpen(false)}
          className="fixed inset-0 bg-black/20 z-20 md:hidden backdrop-blur-xs"
        />
      )}

      {/* Share & Permissions Dialog */}
      <ShareDialog
        isOpen={isShareModalOpen}
        onClose={() => setIsShareModalOpen(false)}
        workspaceId={workspaceId}
        currentUserRole={resolvedRole}
        currentUserId={user?.id}
      />
    </div>
  );
}
