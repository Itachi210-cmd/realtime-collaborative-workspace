"use client";

import React from "react";
import { AlertTriangle, RotateCcw, Loader2, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { VersionSummaryData } from "@/lib/api/history";

interface RestoreConfirmationDialogProps {
  isOpen: boolean;
  snapshot: VersionSummaryData | null;
  isRestoring: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export function RestoreConfirmationDialog({
  isOpen,
  snapshot,
  isRestoring,
  error,
  onConfirm,
  onCancel,
}: RestoreConfirmationDialogProps) {
  if (!isOpen || !snapshot) return null;

  const dateObj = new Date(snapshot.createdAt);
  const formattedDate = !isNaN(dateObj.getTime())
    ? dateObj.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }) +
      " at " +
      dateObj.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "Unknown date";

  const authorName = snapshot.createdBy?.name || (snapshot.isAutomatic ? "System" : "Anonymous");

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="restore-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-2xs animate-in fade-in duration-150"
    >
      <div className="relative w-full max-w-md rounded-xl bg-white p-6 shadow-xl border border-neutral-200 space-y-4">
        {/* Close Button */}
        <button
          type="button"
          onClick={onCancel}
          disabled={isRestoring}
          className="absolute top-4 right-4 text-neutral-400 hover:text-neutral-600 disabled:opacity-50 p-1 rounded-md"
          aria-label="Close dialog"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Header Icon + Title */}
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-full bg-amber-100 text-amber-600 shrink-0">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <h2 id="restore-dialog-title" className="text-sm font-semibold text-neutral-900">
              Restore Document Version?
            </h2>
            <p className="text-xs text-neutral-500 mt-0.5">
              Restoring will replace the current document content for all active collaborators.
            </p>
          </div>
        </div>

        {/* Snapshot Summary Box */}
        <div className="p-3 bg-neutral-50 border border-neutral-200 rounded-lg text-xs space-y-1.5">
          <div className="flex items-center justify-between text-neutral-700">
            <span className="font-semibold text-neutral-900">
              {snapshot.label || (snapshot.isAutomatic ? "Automatic Checkpoint" : "Saved Version")}
            </span>
            <span className="text-[11px] text-neutral-500">{formattedDate}</span>
          </div>
          <div className="text-[11px] text-neutral-500 flex items-center gap-2">
            <span>By {authorName}</span>
            {typeof snapshot.wordCount === "number" && (
              <>
                <span>•</span>
                <span>{snapshot.wordCount} words</span>
              </>
            )}
          </div>
          {snapshot.description && (
            <p className="text-[11px] text-neutral-600 pt-1 border-t border-neutral-200/60">
              {snapshot.description}
            </p>
          )}
        </div>

        {/* Safety Guarantee Notice */}
        <div className="flex items-start gap-2 p-2.5 bg-blue-50/70 border border-blue-200 rounded-lg text-xs text-blue-800">
          <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
          <span>
            Don&apos;t worry: an automatic recovery snapshot of your current document will be
            created first so you will never lose any work.
          </span>
        </div>

        {/* Error State */}
        {error && (
          <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600">
            <span>{error}</span>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-neutral-100">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onCancel}
            disabled={isRestoring}
          >
            Cancel
          </Button>

          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={onConfirm}
            disabled={isRestoring}
            className="bg-blue-600 hover:bg-blue-700 text-white gap-1.5"
          >
            {isRestoring ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Restoring...</span>
              </>
            ) : (
              <>
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Restore Version</span>
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

