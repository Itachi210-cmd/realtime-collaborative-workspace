"use client";

import React from "react";
import { Check, Loader2, AlertCircle, CircleDot } from "lucide-react";

export type SaveStatus = "saved" | "saving" | "unsaved" | "error";

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
    case "saving":
      return (
        <span
          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium text-neutral-500 bg-neutral-100/80 animate-pulse transition-all ${className}`}
          title="Saving changes to cloud..."
        >
          <Loader2 className="w-3 h-3 animate-spin text-[#2383e2]" />
          <span>Saving...</span>
        </span>
      );

    case "saved":
      return (
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium text-neutral-500 hover:text-neutral-700 transition-colors ${className}`}
          title="All changes saved to PostgreSQL"
        >
          <Check className="w-3 h-3 text-emerald-600" />
          <span>Saved</span>
        </span>
      );

    case "unsaved":
      return (
        <span
          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200/60 transition-all ${className}`}
          title="Changes will auto-save in a moment"
        >
          <CircleDot className="w-3 h-3 text-amber-500 animate-pulse" />
          <span>Unsaved changes</span>
        </span>
      );

    case "error":
      return (
        <button
          type="button"
          onClick={onRetry}
          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium text-red-700 bg-red-50 border border-red-200 hover:bg-red-100 transition-colors cursor-pointer ${className}`}
          title={errorMessage || "Failed to save changes. Click to retry."}
        >
          <AlertCircle className="w-3 h-3 text-red-600" />
          <span>Save failed (retry)</span>
        </button>
      );
  }
}

