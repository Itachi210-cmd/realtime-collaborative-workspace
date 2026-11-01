"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  Menu,
  Share2,
  Users,
  Copy,
  Check,
  Shield,
  LogOut,
} from "lucide-react";
import { WorkspaceSidebar } from "@/components/workspace/WorkspaceSidebar";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";
import { useCurrentUser } from "@/lib/auth/useCurrentUser";
import { WorkspaceMemberInfo } from "@/lib/api/workspaces";

interface AppShellProps {
  children: React.ReactNode;
  workspaceId?: string;
  pageTitle?: string;
  showSidebar?: boolean;
}

export function AppShell({
  children,
  workspaceId = "ws-main",
  pageTitle = "Page",
  showSidebar = true,
}: AppShellProps) {
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [members, setMembers] = useState<WorkspaceMemberInfo[]>([]);
  const { addToast } = useToast();
  const { user, logout } = useCurrentUser();

  useEffect(() => {
    let isMounted = true;
    if (isShareModalOpen && workspaceId) {
      fetch(`/api/workspaces/${workspaceId}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (isMounted && data?.workspace?.members) {
            setMembers(data.workspace.members);
          }
        })
        .catch(() => {});
    }
    return () => {
      isMounted = false;
    };
  }, [isShareModalOpen, workspaceId]);

  const userInitials = user?.name
    ? user.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "ME";

  const handleCopyLink = () => {
    setCopiedLink(true);
    addToast({
      message: "Workspace link copied",
      description: "Anyone with access can view this page.",
      variant: "success",
    });
    setTimeout(() => setCopiedLink(false), 2000);
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-white text-[#37352f]">
      {/* Sidebar for desktop & mobile drawer */}
      {showSidebar && (
        <WorkspaceSidebar
          workspaceId={workspaceId}
          isOpen={isMobileSidebarOpen}
          onClose={() => setIsMobileSidebarOpen(false)}
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

      {/* Share & Permissions Dialog (02_UI_DESIGN_WORKFLOW.md Section 3.G) */}
      <Dialog
        isOpen={isShareModalOpen}
        onClose={() => setIsShareModalOpen(false)}
        title="Share & Permissions"
        description="Manage workspace members and collaborative access levels."
        footer={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setIsShareModalOpen(false)}
          >
            Done
          </Button>
        }
      >
        <div className="space-y-4">
          {/* Quick link copy */}
          <div className="flex items-center gap-2 p-2 bg-[#fbfbfa] border border-[#e9e9e7] rounded-lg">
            <span className="text-xs text-neutral-600 truncate flex-1 font-mono">
              http://localhost:3000/workspace/{workspaceId}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopyLink}
              className="shrink-0"
            >
              {copiedLink ? (
                <>
                  <Check className="w-3 h-3 text-emerald-600 mr-1" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3 mr-1" />
                  <span>Copy Link</span>
                </>
              )}
            </Button>
          </div>

          {/* Members & Roles List */}
          <div className="space-y-2">
            <div className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
              Workspace Members ({members.length > 0 ? members.length : 1})
            </div>

            <div className="divide-y divide-[#e9e9e7] border border-[#e9e9e7] rounded-lg overflow-hidden max-h-56 overflow-y-auto">
              {members.length > 0 ? (
                members.map((member) => {
                  const isCurrent = user?.id === member.userId;
                  const initials = member.name
                    ? member.name
                        .split(" ")
                        .map((n) => n[0])
                        .join("")
                        .toUpperCase()
                        .slice(0, 2)
                    : "M";
                  return (
                    <div key={member.id} className="p-2.5 bg-white flex items-center justify-between">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-semibold shrink-0">
                          {initials}
                        </div>
                        <div className="min-w-0">
                          <span className="text-xs font-medium text-[#37352f] block truncate">
                            {member.name} {isCurrent && "(You)"}
                          </span>
                          <span className="text-[11px] text-neutral-400 block truncate">
                            {member.email}
                          </span>
                        </div>
                      </div>
                      <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-blue-50 text-[#2383e2] border border-blue-200 shrink-0">
                        {member.role}
                      </span>
                    </div>
                  );
                })
              ) : (
                <div className="p-2.5 bg-white flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-semibold">
                      {userInitials}
                    </div>
                    <div>
                      <span className="text-xs font-medium text-[#37352f] block">
                        {user?.name || "Intern Engineer"} (You)
                      </span>
                      <span className="text-[11px] text-neutral-400">
                        {user?.email || "owner@workspace.dev"}
                      </span>
                    </div>
                  </div>
                  <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-blue-50 text-[#2383e2] border border-blue-200">
                    Owner
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="p-2.5 rounded-lg bg-neutral-50 border border-neutral-200/70 flex items-start gap-2 text-xs text-neutral-500">
            <Shield className="w-4 h-4 text-neutral-400 shrink-0 mt-0.5" />
            <p>
              Role permissions (Owner, Editor, Commenter, Viewer) will be enforced server-side in <strong>Phase 9</strong> per the architectural blueprint.
            </p>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
