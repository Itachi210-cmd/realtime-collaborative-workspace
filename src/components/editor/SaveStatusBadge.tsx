"use client";

import React from "react";
import { Check, Loader2, AlertCircle, CloudOff } from "lucide-react";

export type SaveStatus =
  | "saved"
  | "saving"
  | "unsaved"
  | "error"
  | "connecting"
  | "syncing"
  | "reconnecting"
  | "offline";

interface SaveStatusBadgeProps {
  status: SaveStatus;
  errorMessage?: string;
  onRetry?: () => void;
  className?: string;
}

export function SaveStatusBadge({
  status,
  errorMessage,
  onRetry,
  className = "",
}: SaveStatusBadgeProps) {
  switch (status) {
    case "connecting":
      return (
        <span
          className={`inline-flex items-center gap-1 text-[11px] font-medium text-[var(--text-muted)] ${className}`}
          title="Connecting to collaboration server..."
        >
          <Loader2 className="w-3 h-3 animate-spin text-[var(--text-faint)]" />
          <span>Connecting</span>
        </span>
      );

    case "syncing":
      return (
        <span
          className={`inline-flex items-center gap-1 text-[11px] font-medium text-[var(--text-muted)] ${className}`}
          title="Synchronizing document with server..."
        >
          <Loader2 className="w-3 h-3 animate-spin text-[var(--text-faint)]" />
          <span>Syncing</span>
        </span>
      );

    case "saving":
      return (
        <span
          className={`inline-flex items-center gap-1 text-[11px] font-medium text-[var(--accent)] ${className}`}
          title="Saving changes to PostgreSQL..."
        >
          <Loader2 className="w-3 h-3 animate-spin text-[var(--accent)]" />
          <span>Saving</span>
        </span>
      );

    case "saved":
      return (
        <span
          className={`inline-flex items-center gap-1 text-[11px] font-medium text-[var(--text-muted)] ${className}`}
          title="All changes saved to PostgreSQL"
        >
          <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
          <span>Saved</span>
        </span>
      );

    case "reconnecting":
      return (
        <span
          className={`inline-flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-400 ${className}`}
          title="Connection interrupted. Reconnecting..."
        >
          <Loader2 className="w-3 h-3 animate-spin text-amber-600 dark:text-amber-400" />
          <span>Reconnecting</span>
        </span>
      );

    case "offline":
      return (
        <span
          className={`inline-flex items-center gap-1 text-[11px] font-medium text-[var(--text-faint)] ${className}`}
          title="Disconnected from server. Edits cannot be saved until reconnected."
        >
          <CloudOff className="w-3 h-3 text-[var(--text-faint)]" />
          <span>Offline</span>
        </span>
      );

    case "unsaved":
      return (
        <span
          className={`inline-flex items-center gap-1 text-[11px] font-medium text-[var(--accent)] ${className}`}
          title="Changes will auto-save in a moment"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] shrink-0" />
          <span>Unsaved</span>
        </span>
      );

    case "error":
      return (
        <button
          type="button"
          onClick={onRetry}
          className={`inline-flex items-center gap-1 text-[11px] font-medium text-red-600 dark:text-red-400 hover:underline cursor-pointer ${className}`}
          title={errorMessage || "Failed to save changes. Click to retry."}
        >
          <AlertCircle className="w-3 h-3 text-red-600 dark:text-red-400" />
          <span>Retry save</span>
        </button>
      );
  }
}
