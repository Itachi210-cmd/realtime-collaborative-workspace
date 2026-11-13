"use client";

import React, { useState } from "react";
import {
  User,
  Key,
  Calendar,
  Eye,
  EyeOff,
  Loader2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { AuthenticatedUser } from "@/lib/auth/useCurrentUser";

export interface AccountSettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  user: AuthenticatedUser | null;
  onProfileUpdated?: () => void;
}

export function AccountSettingsDialog({
  isOpen,
  onClose,
  user,
  onProfileUpdated,
}: AccountSettingsDialogProps) {
  const { addToast } = useToast();

  const [name, setName] = useState<string>("");
  const [showPasswordSection, setShowPasswordSection] = useState<boolean>(false);
  const [currentPassword, setCurrentPassword] = useState<string>("");
  const [newPassword, setNewPassword] = useState<string>("");
  const [confirmNewPassword, setConfirmNewPassword] = useState<string>("");

  const [showCurrentPass, setShowCurrentPass] = useState<boolean>(false);
  const [showNewPass, setShowNewPass] = useState<boolean>(false);
  const [showConfirmPass, setShowConfirmPass] = useState<boolean>(false);

  const [fieldErrors, setFieldErrors] = useState<{
    name?: string;
    currentPassword?: string;
    newPassword?: string;
    confirmNewPassword?: string;
    form?: string;
  }>({});
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Sync state whenever dialog opens or user prop changes (per React recommendations)
  const [prevIsOpen, setPrevIsOpen] = useState<boolean>(isOpen);
  const [prevUser, setPrevUser] = useState<AuthenticatedUser | null>(user);
  if (isOpen !== prevIsOpen || user !== prevUser) {
    setPrevIsOpen(isOpen);
    setPrevUser(user);
    if (isOpen && user) {
      setName(user.name || "");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
      setShowPasswordSection(false);
      setFieldErrors({});
    }
  }

  const initials = (name || user?.name || "U")
    .split(" ")
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const formattedJoinedDate = user?.createdAt
    ? new Date(user.createdAt).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : null;

  const validateClient = (): boolean => {
    const errors: typeof fieldErrors = {};

    const trimmedName = name.trim();
    if (!trimmedName || trimmedName.length < 2) {
      errors.name = "Full name must be at least 2 characters.";
    } else if (trimmedName.length > 60) {
      errors.name = "Full name cannot exceed 60 characters.";
    }

    if (showPasswordSection) {
      if (!currentPassword) {
        errors.currentPassword = "Current password is required to change password.";
      }

      if (!newPassword) {
        errors.newPassword = "New password is required.";
      } else {
        if (newPassword.length < 8) {
          errors.newPassword = "New password must be at least 8 characters.";
        } else if (newPassword.length > 128) {
          errors.newPassword = "New password cannot exceed 128 characters.";
        }
        const hasLetter = /[a-zA-Z]/.test(newPassword);
        const hasNumOrSymbol = /[0-9!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(newPassword);
        if (!hasLetter || !hasNumOrSymbol) {
          errors.newPassword =
            "New password must contain at least one letter and one number or symbol.";
        }
      }

      if (currentPassword && newPassword && currentPassword === newPassword) {
        errors.newPassword = "New password must be different from current password.";
      }

      if (newPassword && newPassword !== confirmNewPassword) {
        errors.confirmNewPassword = "New passwords do not match.";
      }
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateClient()) return;

    setIsSubmitting(true);
    setFieldErrors({});

    try {
      const payload: {
        name: string;
        currentPassword?: string;
        newPassword?: string;
        confirmNewPassword?: string;
      } = {
        name: name.trim(),
      };

      if (showPasswordSection && newPassword) {
        payload.currentPassword = currentPassword;
        payload.newPassword = newPassword;
        payload.confirmNewPassword = confirmNewPassword;
      }

      const res = await fetch("/api/auth/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (data.issues) {
          const mappedIssues: Record<string, string> = {};
          for (const [key, msgs] of Object.entries(data.issues)) {
            if (Array.isArray(msgs) && msgs.length > 0) {
              mappedIssues[key] = msgs[0];
            }
          }
          setFieldErrors({
            ...mappedIssues,
            form: data.error || "Please review the highlighted errors.",
          });
        } else {
          setFieldErrors({ form: data.error || "Failed to update profile." });
        }

        addToast({
          message: "Update failed",
          description: data.error || "Could not save account changes.",
          variant: "error",
        });
        return;
      }

      addToast({
        message: "Profile updated",
        description: "Your account settings have been saved successfully.",
        variant: "success",
      });

      // Clear sensitive fields
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
      setShowPasswordSection(false);

      if (onProfileUpdated) {
        onProfileUpdated();
      }

      onClose();
    } catch {
      setFieldErrors({ form: "An unexpected error occurred. Please try again." });
      addToast({
        message: "Error",
        description: "An unexpected network or server error occurred.",
        variant: "error",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Account Settings"
      description="Manage your profile information and security preferences."
      maxWidth="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4 pt-1">
        {/* Profile Overview Card */}
        <div className="flex items-center gap-3.5 p-3 rounded-lg bg-[var(--bg-raised)] border border-[var(--border-subtle)]">
          <div className="w-12 h-12 rounded-full bg-[var(--accent-light)] border border-[var(--accent-border)] flex items-center justify-center text-sm font-semibold text-[var(--accent)] shrink-0 select-none">
            {initials}
          </div>
          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-[var(--text-primary)] truncate">
                {user?.name || "Collaborator"}
              </span>
            </div>
            <div className="text-xs text-[var(--text-muted)] truncate">
              {user?.email || "No email address"}
            </div>
            {formattedJoinedDate && (
              <div className="flex items-center gap-1 text-[11px] text-[var(--text-faint)] pt-0.5">
                <Calendar className="w-3 h-3 shrink-0" />
                <span>Joined {formattedJoinedDate}</span>
              </div>
            )}
          </div>
        </div>

        {/* Global Error Banner */}
        {fieldErrors.form && (
          <div className="flex items-center gap-2 p-2.5 rounded-md bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-xs text-red-600 dark:text-red-400">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{fieldErrors.form}</span>
          </div>
        )}

        {/* Name Edit Section */}
        <div className="space-y-1.5">
          <label
            htmlFor="account-settings-name"
            className="text-xs font-medium text-[var(--text-muted)] flex items-center gap-1.5"
          >
            <User className="w-3.5 h-3.5 text-[var(--text-faint)]" />
            <span>Full Name</span>
          </label>
          <Input
            id="account-settings-name"
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (fieldErrors.name) {
                setFieldErrors((prev) => ({ ...prev, name: undefined }));
              }
            }}
            placeholder="Jane Doe"
            disabled={isSubmitting}
            error={fieldErrors.name}
            className="text-sm h-9"
          />
        </div>

        {/* Email Field (Strictly Read-Only) */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[var(--text-muted)]">Email Address</span>
            <span className="text-[10px] text-[var(--text-faint)] uppercase tracking-wider font-mono">
              Read-Only
            </span>
          </div>
          <Input
            id="account-settings-email"
            type="email"
            value={user?.email || ""}
            readOnly
            disabled
            className="text-sm h-9 opacity-70 cursor-not-allowed bg-[var(--bg-surface)]"
          />
          <p className="text-[11px] text-[var(--text-faint)]">
            Account email is linked to your workspace memberships and cannot be changed.
          </p>
        </div>

        {/* Password Change Accordion */}
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden">
          <button
            type="button"
            onClick={() => {
              setShowPasswordSection((prev) => !prev);
              setFieldErrors((prev) => ({
                ...prev,
                currentPassword: undefined,
                newPassword: undefined,
                confirmNewPassword: undefined,
              }));
            }}
            className="w-full flex items-center justify-between p-3 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer select-none"
            aria-expanded={showPasswordSection}
          >
            <div className="flex items-center gap-2">
              <Key className="w-3.5 h-3.5 text-[var(--text-faint)]" />
              <span>Change Password</span>
            </div>
            {showPasswordSection ? (
              <ChevronUp className="w-4 h-4 text-[var(--text-faint)]" />
            ) : (
              <ChevronDown className="w-4 h-4 text-[var(--text-faint)]" />
            )}
          </button>

          {showPasswordSection && (
            <div className="p-3 pt-0 space-y-3 border-t border-[var(--border-subtle)] bg-[var(--bg-raised)]/50">
              <p className="text-[11px] text-[var(--text-muted)] pt-2">
                Enter your current password followed by your new password (minimum 8 characters with at least one letter and one number or symbol).
              </p>

              {/* Current Password */}
              <div className="space-y-1">
                <label
                  htmlFor="account-current-password"
                  className="text-xs font-medium text-[var(--text-muted)]"
                >
                  Current Password
                </label>
                <div className="relative">
                  <Input
                    id="account-current-password"
                    type={showCurrentPass ? "text" : "password"}
                    value={currentPassword}
                    onChange={(e) => {
                      setCurrentPassword(e.target.value);
                      if (fieldErrors.currentPassword) {
                        setFieldErrors((prev) => ({
                          ...prev,
                          currentPassword: undefined,
                        }));
                      }
                    }}
                    disabled={isSubmitting}
                    error={fieldErrors.currentPassword}
                    className="text-sm h-9 pr-9"
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrentPass((prev) => !prev)}
                    className="absolute right-2.5 top-2.5 text-[var(--text-faint)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                    tabIndex={-1}
                    aria-label={showCurrentPass ? "Hide password" : "Show password"}
                  >
                    {showCurrentPass ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              {/* New Password */}
              <div className="space-y-1">
                <label
                  htmlFor="account-new-password"
                  className="text-xs font-medium text-[var(--text-muted)]"
                >
                  New Password
                </label>
                <div className="relative">
                  <Input
                    id="account-new-password"
                    type={showNewPass ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => {
                      setNewPassword(e.target.value);
                      if (fieldErrors.newPassword) {
                        setFieldErrors((prev) => ({ ...prev, newPassword: undefined }));
                      }
                    }}
                    disabled={isSubmitting}
                    error={fieldErrors.newPassword}
                    className="text-sm h-9 pr-9"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPass((prev) => !prev)}
                    className="absolute right-2.5 top-2.5 text-[var(--text-faint)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                    tabIndex={-1}
                    aria-label={showNewPass ? "Hide password" : "Show password"}
                  >
                    {showNewPass ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              {/* Confirm New Password */}
              <div className="space-y-1">
                <label
                  htmlFor="account-confirm-password"
                  className="text-xs font-medium text-[var(--text-muted)]"
                >
                  Confirm New Password
                </label>
                <div className="relative">
                  <Input
                    id="account-confirm-password"
                    type={showConfirmPass ? "text" : "password"}
                    value={confirmNewPassword}
                    onChange={(e) => {
                      setConfirmNewPassword(e.target.value);
                      if (fieldErrors.confirmNewPassword) {
                        setFieldErrors((prev) => ({
                          ...prev,
                          confirmNewPassword: undefined,
                        }));
                      }
                    }}
                    disabled={isSubmitting}
                    error={fieldErrors.confirmNewPassword}
                    className="text-sm h-9 pr-9"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPass((prev) => !prev)}
                    className="absolute right-2.5 top-2.5 text-[var(--text-faint)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                    tabIndex={-1}
                    aria-label={showConfirmPass ? "Hide password" : "Show password"}
                  >
                    {showConfirmPass ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border-subtle)]">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={isSubmitting}
            className="text-xs h-8"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={isSubmitting || !name.trim()}
            className="text-xs h-8 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white border-transparent"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                <span>Saving...</span>
              </>
            ) : (
              <span>Save Changes</span>
            )}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
