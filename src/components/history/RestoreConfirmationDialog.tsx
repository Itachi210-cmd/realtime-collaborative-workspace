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
      <div className="relative w-full max-w-md rounded-xl bg-[var(--bg-surface)] p-6 shadow-xl border border-[var(--border-subtle)] text-[var(--text-primary)] space-y-4">
        {/* Close Button */}
        <button
          type="button"
          onClick={onCancel}
          disabled={isRestoring}
          className="absolute top-4 right-4 text-[var(--text-faint)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-50 p-1 rounded-md transition-colors"
          aria-label="Close dialog"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Header Icon + Title */}
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400 shrink-0 border border-amber-500/20">
            <AlertTriangle className="w-4 h-4" />
          </div>
          <div>
            <h2 id="restore-dialog-title" className="text-sm font-medium text-[var(--text-primary)]">
              Restore Document Version?
            </h2>
            <p className="text-xs text-[var(--text-muted)] mt-0.5 leading-relaxed">
              Restoring will replace the current document content for all active collaborators.
            </p>
          </div>
        </div>

        {/* Snapshot Summary Box */}
        <div className="p-3 bg-[var(--bg-raised)]/50 border border-[var(--border-subtle)] rounded-md text-xs space-y-1.5">
          <div className="flex items-center justify-between text-[var(--text-muted)]">
            <span className="font-medium text-[var(--text-primary)]">
              {snapshot.label || (snapshot.isAutomatic ? "Automatic Checkpoint" : "Saved Version")}
            </span>
            <span className="text-[11px] font-mono text-[var(--text-faint)]">{formattedDate}</span>
          </div>
          <div className="text-[11px] text-[var(--text-muted)] flex items-center gap-2">
            <span>By {authorName}</span>
            {typeof snapshot.wordCount === "number" && (
              <>
                <span>•</span>
                <span className="font-mono">{snapshot.wordCount} words</span>
              </>
            )}
          </div>
          {snapshot.description && (
            <p className="text-[11px] text-[var(--text-muted)] pt-1 border-t border-[var(--border-subtle)] leading-relaxed">
              {snapshot.description}
            </p>
          )}
        </div>

        {/* Safety Guarantee Notice */}
        <div className="flex items-start gap-2 p-2.5 bg-[var(--accent-light)] border border-[var(--accent-border)]/40 rounded-md text-xs text-[var(--accent)]">
          <ShieldCheck className="w-4 h-4 text-[var(--accent)] shrink-0 mt-0.5" />
          <span className="leading-relaxed">
            An automatic recovery snapshot of your current document will be created first so no work is lost.
          </span>
        </div>

        {/* Error State */}
        {error && (
          <div className="p-2.5 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-600 dark:text-red-400">
            <span>{error}</span>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border-subtle)]">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onCancel}
            disabled={isRestoring}
            className="bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-[var(--border-subtle)]"
          >
            Cancel
          </Button>

          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={onConfirm}
            disabled={isRestoring}
            className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white gap-1.5 border-transparent"
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

