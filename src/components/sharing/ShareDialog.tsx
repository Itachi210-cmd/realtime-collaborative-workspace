"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Copy,
  Check,
  Shield,
  Trash2,
  UserPlus,
  Loader2,
  AlertCircle,
  Crown,
} from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { RoleSelector, SelectableRole } from "./RoleSelector";
import {
  WorkspaceMemberRecord,
  getWorkspaceMembers,
  addWorkspaceMember,
  updateWorkspaceMemberRole,
  removeWorkspaceMember,
  WorkspaceRole,
} from "@/lib/api/members";

interface ShareDialogProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceId: string;
  currentUserRole?: WorkspaceRole | string;
  currentUserId?: string;
}

export function ShareDialog({
  isOpen,
  onClose,
  workspaceId,
  currentUserRole = "VIEWER",
  currentUserId,
}: ShareDialogProps) {
  const { addToast } = useToast();

  const [members, setMembers] = useState<WorkspaceMemberRecord[]>([]);
  const [ownerInfo, setOwnerInfo] = useState<{ id: string; name: string; email: string } | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Invite member form state
  const [inviteEmail, setInviteEmail] = useState<string>("");
  const [inviteRole, setInviteRole] = useState<SelectableRole>("EDITOR");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Member action states (updating or removing)
  const [updatingMemberId, setUpdatingMemberId] = useState<string | null>(null);
  const [memberToRemove, setMemberToRemove] = useState<WorkspaceMemberRecord | null>(null);
  const [isRemoving, setIsRemoving] = useState<boolean>(false);

  // Link copy state
  const [copiedLink, setCopiedLink] = useState<boolean>(false);

  const isOwner = currentUserRole === "OWNER";

  // Fetch workspace details and members list
  const loadWorkspaceData = useCallback(
    async (signal?: AbortSignal) => {
      if (!workspaceId) return;
      setIsLoading(true);
      setFetchError(null);

      try {
        // 1. Fetch workspace detail to obtain owner info and user role
        const wsRes = await fetch(`/api/workspaces/${workspaceId}`, {
          cache: "no-store",
          signal,
        });

        if (wsRes.ok) {
          const wsData = await wsRes.json();
          if (wsData?.workspace?.owner) {
            setOwnerInfo(wsData.workspace.owner);
          }
        }

        // 2. Fetch member list from dedicated members endpoint
        const memberList = await getWorkspaceMembers(workspaceId, signal);
        setMembers(memberList);
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        const msg = err instanceof Error ? err.message : "Failed to load members";
        setFetchError(msg);
      } finally {
        setIsLoading(false);
      }
    },
    [workspaceId]
  );

  useEffect(() => {
    if (!isOpen || !workspaceId) return;
    let ignore = false;
    const controller = new AbortController();

    async function fetchData() {
      try {
        const [wsRes, memberList] = await Promise.all([
          fetch(`/api/workspaces/${workspaceId}`, {
            cache: "no-store",
            signal: controller.signal,
          }),
          getWorkspaceMembers(workspaceId, controller.signal),
        ]);

        if (!ignore) {
          if (wsRes.ok) {
            const wsData = await wsRes.json();
            if (wsData?.workspace?.owner) {
              setOwnerInfo(wsData.workspace.owner);
            }
          }
          setMembers(memberList);
          setFetchError(null);
          setIsLoading(false);
        }
      } catch (err: unknown) {
        if (!ignore) {
          if (err instanceof DOMException && err.name === "AbortError") return;
          const msg = err instanceof Error ? err.message : "Failed to load members";
          setFetchError(msg);
          setIsLoading(false);
        }
      }
    }

    fetchData();

    return () => {
      ignore = true;
      controller.abort();
    };
  }, [isOpen, workspaceId]);

  const handleCopyLink = () => {
    const url = typeof window !== "undefined" ? window.location.href : "";
    if (navigator?.clipboard?.writeText && url) {
      navigator.clipboard.writeText(url).catch(() => {});
    }
    setCopiedLink(true);
    addToast({
      message: "Workspace link copied",
      description: "Anyone with access to this workspace can open this link.",
      variant: "success",
    });
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleInviteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const email = inviteEmail.trim().toLowerCase();
    if (!email) {
      setFormError("Please enter an email address.");
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setFormError("Please enter a valid email address.");
      return;
    }

    if (ownerInfo && email === ownerInfo.email.toLowerCase()) {
      setFormError("The workspace owner already has full administrative access.");
      return;
    }

    setIsSubmitting(true);
    try {
      const newMember = await addWorkspaceMember(workspaceId, email, inviteRole);
      setMembers((prev) => [...prev, newMember]);
      setInviteEmail("");
      addToast({
        message: "Member added",
        description: `Added ${newMember.name || email} as ${newMember.role.toLowerCase()}.`,
        variant: "success",
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to add member";
      setFormError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRoleChange = async (memberId: string, newRole: SelectableRole) => {
    setUpdatingMemberId(memberId);
    try {
      const updated = await updateWorkspaceMemberRole(workspaceId, memberId, newRole);
      setMembers((prev) =>
        prev.map((m) => (m.id === memberId ? { ...m, role: updated.role } : m))
      );
      addToast({
        message: "Role updated",
        description: `Member role changed to ${updated.role.toLowerCase()}.`,
        variant: "success",
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to update role";
      addToast({
        message: "Error updating role",
        description: msg,
        variant: "error",
      });
    } finally {
      setUpdatingMemberId(null);
    }
  };

  const handleConfirmRemove = async () => {
    if (!memberToRemove) return;
    setIsRemoving(true);
    try {
      await removeWorkspaceMember(workspaceId, memberToRemove.id);
      setMembers((prev) => prev.filter((m) => m.id !== memberToRemove.id));
      addToast({
        message: "Member removed",
        description: `${memberToRemove.name || memberToRemove.email} was removed from the workspace.`,
        variant: "info",
      });
      setMemberToRemove(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to remove member";
      addToast({
        message: "Error removing member",
        description: msg,
        variant: "error",
      });
    } finally {
      setIsRemoving(false);
    }
  };

  const getInitials = (name?: string, fallback = "M") => {
    if (!name) return fallback;
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <>
      <Dialog
        isOpen={isOpen}
        onClose={onClose}
        title="Share & Workspace Members"
        description="Manage workspace collaborators and access permissions."
        footer={
          <Button variant="secondary" size="sm" onClick={onClose}>
            Done
          </Button>
        }
        maxWidth="md"
      >
        <div className="space-y-4">
          {/* Quick link copy */}
          <div className="flex items-center gap-2 p-2 bg-[#fbfbfa] border border-[#e9e9e7] rounded-lg">
            <span className="text-xs text-neutral-600 truncate flex-1 font-mono">
              {typeof window !== "undefined"
                ? `${window.location.origin}/workspace/${workspaceId}`
                : `/workspace/${workspaceId}`}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopyLink}
              className="shrink-0"
            >
              {copiedLink ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-600 mr-1" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 mr-1" />
                  <span>Copy Link</span>
                </>
              )}
            </Button>
          </div>

          {/* Invite form - strictly for OWNER */}
          {isOwner ? (
            <form onSubmit={handleInviteSubmit} className="space-y-2 p-3 bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded-lg">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)]">
                <UserPlus className="w-3.5 h-3.5 text-[var(--accent)]" />
                <span>Invite Registered User</span>
              </div>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <Input
                  type="email"
                  placeholder="user@example.com"
                  value={inviteEmail}
                  onChange={(e) => {
                    setInviteEmail(e.target.value);
                    if (formError) setFormError(null);
                  }}
                  disabled={isSubmitting}
                  className="text-xs h-8 flex-1"
                />
                <RoleSelector
                  value={inviteRole}
                  onChange={setInviteRole}
                  disabled={isSubmitting}
                  size="md"
                />
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={isSubmitting || !inviteEmail.trim()}
                  className="shrink-0 h-8 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white border-transparent"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-3 h-3 animate-spin mr-1" />
                      <span>Adding...</span>
                    </>
                  ) : (
                    <span>Add Member</span>
                  )}
                </Button>
              </div>
              {formError && (
                <div className="flex items-center gap-1 text-[11px] text-red-600 dark:text-red-400 pt-1">
                  <AlertCircle className="w-3 h-3 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}
            </form>
          ) : (
            <div className="p-2.5 rounded-lg bg-[var(--bg-raised)] border border-[var(--border-subtle)] flex items-start gap-2 text-xs text-[var(--text-muted)]">
              <Shield className="w-4 h-4 text-[var(--text-faint)] shrink-0 mt-0.5" />
              <p>
                Only the workspace owner can invite new collaborators or modify member roles.
              </p>
            </div>
          )}

          {/* Members list */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[11px] font-semibold text-[var(--text-faint)] uppercase tracking-wider">
              <span>
                Workspace Members ({(ownerInfo ? 1 : 0) + members.length})
              </span>
              {isLoading && <Loader2 className="w-3 h-3 animate-spin text-[var(--text-faint)]" />}
            </div>

            {fetchError ? (
              <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-600 dark:text-red-400 flex items-center justify-between">
                <span>{fetchError}</span>
                <Button variant="ghost" size="sm" onClick={() => loadWorkspaceData()}>
                  Retry
                </Button>
              </div>
            ) : (
              <div className="divide-y divide-[var(--border-subtle)] border border-[var(--border-subtle)] rounded-lg overflow-hidden max-h-60 overflow-y-auto">
                {/* 1. Workspace Owner Row (Immunized against modification/removal) */}
                {ownerInfo && (
                  <div className="p-2.5 bg-[var(--bg-surface)] flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-7 h-7 rounded-full bg-amber-500/20 text-amber-700 dark:text-amber-400 flex items-center justify-center text-xs font-semibold shrink-0">
                        {getInitials(ownerInfo.name, "OW")}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-medium text-[var(--text-primary)] truncate">
                            {ownerInfo.name}
                          </span>
                          {currentUserId === ownerInfo.id && (
                            <span className="text-[10px] text-[var(--text-faint)] font-normal">
                              (You)
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] text-[var(--text-faint)] block truncate">
                          {ownerInfo.email}
                        </span>
                      </div>
                    </div>
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/30 shrink-0">
                      <Crown className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                      <span>Owner</span>
                    </span>
                  </div>
                )}

                {/* 2. Workspace Members Rows */}
                {members.length > 0 ? (
                  members.map((member) => {
                    const isSelf = currentUserId === member.userId;
                    const isUpdating = updatingMemberId === member.id;

                    return (
                      <div
                        key={member.id}
                        className="p-2.5 bg-[var(--bg-surface)] flex items-center justify-between gap-2 hover:bg-[var(--bg-hover)] transition-colors"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-7 h-7 rounded-full bg-[var(--accent-light)] text-[var(--accent)] flex items-center justify-center text-xs font-semibold shrink-0 border border-[var(--accent-border)]/40">
                            {getInitials(member.name, "M")}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-medium text-[var(--text-primary)] truncate">
                                {member.name}
                              </span>
                              {isSelf && (
                                <span className="text-[10px] text-[var(--text-faint)] font-normal">
                                  (You)
                                </span>
                              )}
                            </div>
                            <span className="text-[11px] text-[var(--text-faint)] block truncate">
                              {member.email}
                            </span>
                          </div>
                        </div>

                        {/* Role controls: dropdown for OWNER, badge for non-owners */}
                        <div className="flex items-center gap-1.5 shrink-0">
                          {isOwner ? (
                            <>
                              <RoleSelector
                                value={member.role as SelectableRole}
                                onChange={(newRole) => handleRoleChange(member.id, newRole)}
                                disabled={isUpdating}
                                size="sm"
                              />
                              <button
                                onClick={() => setMemberToRemove(member)}
                                className="p-1 rounded text-[var(--text-faint)] hover:text-red-600 hover:bg-red-500/10 transition-colors"
                                title="Remove member"
                                aria-label={`Remove ${member.name}`}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          ) : (
                            <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-[var(--accent-light)] text-[var(--accent)] border border-[var(--accent-border)]/40">
                              {member.role.charAt(0) + member.role.slice(1).toLowerCase()}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  !ownerInfo && !isLoading && (
                    <div className="p-4 text-center text-xs text-neutral-400">
                      No members found.
                    </div>
                  )
                )}
              </div>
            )}
          </div>
        </div>
      </Dialog>

      {/* Confirmation Dialog for Member Removal */}
      {memberToRemove && (
        <Dialog
          isOpen={Boolean(memberToRemove)}
          onClose={() => setMemberToRemove(null)}
          title="Remove Workspace Member"
          description={`Are you sure you want to remove ${memberToRemove.name || memberToRemove.email} from this workspace? They will lose access to all documents.`}
          footer={
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setMemberToRemove(null)}
                disabled={isRemoving}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={handleConfirmRemove}
                disabled={isRemoving}
              >
                {isRemoving ? "Removing..." : "Remove Member"}
              </Button>
            </div>
          }
          maxWidth="sm"
        >
          <div className="text-xs text-neutral-500 py-2">
            This action immediately revokes their workspace collaboration privileges and access tokens.
          </div>
        </Dialog>
      )}
    </>
  );
}
