"use client";

import React from "react";
import { Loader2, AlertCircle, WifiOff } from "lucide-react";
import { CollabConnectionStatus } from "@/lib/collab/collab-provider";

interface CollabStatusBadgeProps {
  status: CollabConnectionStatus;
  errorMessage?: string | null;
  onRetry?: () => void;
  className?: string;
}

export function CollabStatusBadge({
  status,
  errorMessage,
  onRetry,
  className = "",
}: CollabStatusBadgeProps) {
  switch (status) {
    case "connecting":
      return (
        <span
          className={`inline-flex items-center gap-1 text-[11px] font-medium text-[var(--text-faint)] ${className}`}
          title="Connecting to collaboration server..."
        >
          <Loader2 className="w-3 h-3 animate-spin text-[var(--text-faint)]" />
          <span>Connecting</span>
        </span>
      );

    case "connected":
      return (
        <span
          className={`inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--text-muted)] ${className}`}
          title="Connected to real-time collaboration room"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 dark:bg-emerald-400 shrink-0" />
          <span>Live</span>
        </span>
      );

    case "reconnecting":
      return (
        <span
          className={`inline-flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-400 ${className}`}
          title="Connection interrupted. Reconnecting with fresh token..."
        >
          <Loader2 className="w-3 h-3 animate-spin text-amber-600 dark:text-amber-400" />
          <span>Reconnecting</span>
        </span>
      );

    case "disconnected":
      return (
        <span
          className={`inline-flex items-center gap-1 text-[11px] font-medium text-[var(--text-faint)] ${className}`}
          title="Collaboration disconnected"
        >
          <WifiOff className="w-3 h-3 text-[var(--text-faint)]" />
          <span>Offline</span>
        </span>
      );

    case "auth_error":
      return (
        <button
          type="button"
          onClick={onRetry}
          className={`inline-flex items-center gap-1 text-[11px] font-medium text-red-600 dark:text-red-400 hover:underline cursor-pointer ${className}`}
          title={errorMessage || "Authentication failed. Click to retry."}
        >
          <AlertCircle className="w-3 h-3 text-red-600 dark:text-red-400" />
          <span>Auth error</span>
        </button>
      );
  }
}

