"use client";

import React from "react";
import { Loader2, AlertCircle, Wifi, WifiOff } from "lucide-react";
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
          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200/60 animate-pulse ${className}`}
          title="Connecting to collaboration server..."
        >
          <Loader2 className="w-3 h-3 animate-spin text-[#2383e2]" />
          <span>Connecting...</span>
        </span>
      );

    case "connected":
      return (
        <span
          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200/60 ${className}`}
          title="Connected to real-time collaboration room"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <Wifi className="w-3 h-3 text-emerald-600" />
          <span>Live</span>
        </span>
      );

    case "reconnecting":
      return (
        <span
          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200/60 animate-pulse ${className}`}
          title="Connection interrupted. Reconnecting with fresh token..."
        >
          <Loader2 className="w-3 h-3 animate-spin text-amber-600" />
          <span>Reconnecting...</span>
        </span>
      );

    case "disconnected":
      return (
        <span
          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium text-neutral-500 bg-neutral-100 border border-neutral-200 ${className}`}
          title="Collaboration disconnected"
        >
          <WifiOff className="w-3 h-3 text-neutral-400" />
          <span>Disconnected</span>
        </span>
      );

    case "auth_error":
      return (
        <button
          type="button"
          onClick={onRetry}
          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium text-red-700 bg-red-50 border border-red-200 hover:bg-red-100 transition-colors ${
            onRetry ? "cursor-pointer" : ""
          } ${className}`}
          title={errorMessage || "Authentication failed. Click to retry."}
        >
          <AlertCircle className="w-3 h-3 text-red-600" />
          <span>Auth Error {onRetry ? "(retry)" : ""}</span>
        </button>
      );
  }
}

