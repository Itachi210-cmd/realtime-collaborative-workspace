"use client";

import React, { useState, useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  Menu,
  Share2,
  LogOut,
  Sun,
  Moon,
} from "lucide-react";
import { WorkspaceSidebar } from "@/components/workspace/WorkspaceSidebar";
import { Button } from "@/components/ui/Button";
import { useCurrentUser } from "@/lib/auth/useCurrentUser";
import { ShareDialog } from "@/components/sharing/ShareDialog";
import { getWorkspaces } from "@/lib/api/workspaces";

const emptySubscribe = () => () => {};

const themeListeners = new Set<() => void>();
function subscribeTheme(callback: () => void) {
  themeListeners.add(callback);
  return () => {
    themeListeners.delete(callback);
  };
}

function getThemeSnapshot(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  try {
    const saved = localStorage.getItem("collab-theme") as "light" | "dark" | null;
    if (saved === "light" || saved === "dark") return saved;
    if (window.matchMedia("(prefers-color-scheme: dark)").matches) return "dark";
  } catch {}
  return "light";
}

function getServerThemeSnapshot(): "light" | "dark" {
  return "light";
}

interface AppShellProps {
  children: React.ReactNode;
  workspaceId?: string;
  pageTitle?: string;
  showSidebar?: boolean;
  userRole?: string;
}

export function AppShell({
  children,
  workspaceId: propWorkspaceId,
  pageTitle = "Page",
  showSidebar = true,
  userRole: propUserRole,
}: AppShellProps) {
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [resolvedWorkspaceId, setResolvedWorkspaceId] = useState<string>("");
  const [resolvedUserRole, setResolvedUserRole] = useState<string>("");
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false);
  const theme = useSyncExternalStore(subscribeTheme, getThemeSnapshot, getServerThemeSnapshot);

  const activeWorkspaceId = propWorkspaceId || resolvedWorkspaceId;
  const activeUserRole = propUserRole || resolvedUserRole;

  const { user, logout } = useCurrentUser();

  // Synchronize document theme attribute
  useEffect(() => {
    if (!mounted) return;
    document.documentElement.setAttribute("data-theme", theme);
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [theme, mounted]);

  const handleToggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    try {
      localStorage.setItem("collab-theme", next);
    } catch {}
    themeListeners.forEach((listener) => listener());
  };

  // Synchronize active workspace and user role when not provided via props
  useEffect(() => {
    let isMounted = true;

    if (!propWorkspaceId) {
      getWorkspaces()
        .then((workspaces) => {
          if (!isMounted || workspaces.length === 0) return;
          const savedId =
            typeof window !== "undefined"
              ? localStorage.getItem("collab-active-workspace-id")
              : null;
          const targetWs =
            workspaces.find((w) => w.id === savedId) || workspaces[0];
          setResolvedWorkspaceId(targetWs.id);
          setResolvedUserRole(targetWs.role);
        })
        .catch(() => {});
    } else if (!propUserRole) {
      fetch(`/api/workspaces/${propWorkspaceId}`, { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (isMounted && data?.workspace?.userRole) {
            setResolvedUserRole(data.workspace.userRole);
          }
        })
        .catch(() => {});
    }

    return () => {
      isMounted = false;
    };
  }, [propWorkspaceId, propUserRole]);

  const handleWorkspaceChange = (newWorkspaceId: string, role?: string) => {
    setResolvedWorkspaceId(newWorkspaceId);
    if (role) {
      setResolvedUserRole(role);
    } else {
      fetch(`/api/workspaces/${newWorkspaceId}`, { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data?.workspace?.userRole) {
            setResolvedUserRole(data.workspace.userRole);
          }
        })
        .catch(() => {});
    }
    try {
      localStorage.setItem("collab-active-workspace-id", newWorkspaceId);
    } catch {}
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[var(--bg-app)] text-[var(--text-primary)] transition-colors duration-150">
      {/* Sidebar for desktop & mobile drawer */}
      {showSidebar && (
        <WorkspaceSidebar
          workspaceId={activeWorkspaceId}
          isOpen={isMobileSidebarOpen}
          onClose={() => setIsMobileSidebarOpen(false)}
          onWorkspaceChange={handleWorkspaceChange}
          userRole={activeUserRole}
        />
      )}

      {/* Main Layout Area */}
      <div className="flex flex-col flex-1 min-w-0 h-full overflow-hidden">
        {/* Top Navigation Bar */}
        <header className="h-12 px-4 sm:px-5 border-b border-[var(--border-subtle)] flex items-center justify-between bg-[var(--bg-app)] shrink-0 select-none transition-colors duration-150">
          <div className="flex items-center gap-2.5 min-w-0">
            {showSidebar && (
              <button
                onClick={() => setIsMobileSidebarOpen(!isMobileSidebarOpen)}
                className="md:hidden p-1.5 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                aria-label="Toggle menu"
              >
                <Menu className="w-4 h-4" />
              </button>
            )}

            {/* Breadcrumbs */}
            <nav className="flex items-center gap-2 text-xs text-[var(--text-muted)] min-w-0">
              <Link
                href="/dashboard"
                className="hover:text-[var(--text-primary)] transition-colors truncate shrink-0"
              >
                Workspace
              </Link>
              <span className="text-[var(--text-faint)] select-none shrink-0">/</span>
              <span className="text-[var(--text-primary)] font-medium truncate max-w-[120px] sm:max-w-[240px]">
                {pageTitle}
              </span>
            </nav>
          </div>

          {/* Right Header Controls */}
          <div className="flex items-center gap-2">
            {/* Theme Toggle (Light / Dark) */}
            <button
              type="button"
              onClick={handleToggleTheme}
              className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
              title={mounted && theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
              aria-label="Toggle theme"
            >
              {mounted && theme === "dark" ? (
                <Sun className="w-3.5 h-3.5" />
              ) : (
                <Moon className="w-3.5 h-3.5" />
              )}
            </button>

            {/* Share / Role Button */}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setIsShareModalOpen(true)}
              className="hidden xs:inline-flex h-8 px-3 text-xs border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
            >
              <Share2 className="w-3.5 h-3.5 text-[var(--text-muted)] mr-1.5" />
              <span>Share</span>
            </Button>

            {/* User Session / Auth Controls */}
            <div className="flex items-center gap-1.5 pl-2 sm:pl-2.5 border-l border-[var(--border-subtle)]">
              {user ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-[var(--text-muted)] font-medium hidden lg:inline truncate max-w-[140px]">
                    {user.name}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={logout}
                    className="h-8 px-2 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
                    title="Sign Out"
                  >
                    <LogOut className="w-3.5 h-3.5 sm:mr-1" />
                    <span className="hidden sm:inline">Logout</span>
                  </Button>
                </div>
              ) : (
                <>
                  <Link href="/login">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                    >
                      Login
                    </Button>
                  </Link>
                  <Link href="/signup">
                    <Button
                      variant="primary"
                      size="sm"
                      className="h-8 px-3 text-xs bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white border-[var(--accent)]"
                    >
                      Signup
                    </Button>
                  </Link>
                </>
              )}
            </div>
          </div>
        </header>

        {/* Content Body */}
        <main className="flex-1 overflow-y-auto bg-[var(--bg-app)] py-6 px-4 sm:px-8 transition-colors duration-150">
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
        workspaceId={activeWorkspaceId}
        currentUserRole={activeUserRole || "VIEWER"}
        currentUserId={user?.id}
      />
    </div>
  );
}
