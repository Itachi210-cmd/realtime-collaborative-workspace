"use client";

import React from "react";
import { Clock, ShieldAlert, Eye, RotateCcw, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { VersionSummaryData } from "@/lib/api/history";

interface SnapshotItemProps {
  snapshot: VersionSummaryData;
  isSelected?: boolean;
  canRestore?: boolean;
  onPreview: (snapshot: VersionSummaryData) => void;
  onRestore: (snapshot: VersionSummaryData) => void;
}

export function SnapshotItem({
  snapshot,
  isSelected = false,
  canRestore = false,
  onPreview,
  onRestore,
}: SnapshotItemProps) {
  // Format readable timestamp
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
      className={cn(
        "group relative p-3 rounded-md border transition-all text-left",
        isSelected
          ? "bg-[var(--accent-light)]/40 border-[var(--accent-border)] ring-1 ring-[var(--accent)]/30"
          : "bg-[var(--bg-surface)] border border-[var(--border-subtle)] hover:border-[var(--border-strong)]"
      )}
    >
      {/* Header: Label & Type Badge */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span
              className={cn(
                "text-xs font-medium truncate",
                isSelected ? "text-[var(--accent)]" : "text-[var(--text-primary)]"
              )}
            >
              {snapshot.label || (snapshot.isAutomatic ? "Automatic Checkpoint" : "Saved Version")}
            </span>

            {snapshot.isAutomatic ? (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                <ShieldAlert className="w-2.5 h-2.5" />
                <span>Recovery</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono bg-[var(--accent-light)] text-[var(--accent)] border border-[var(--accent-border)]/40">
                <Clock className="w-2.5 h-2.5" />
                <span>Manual</span>
              </span>
            )}
          </div>

          {snapshot.description && (
            <p className="text-[11px] text-[var(--text-muted)] mt-1 line-clamp-2 leading-relaxed">
              {snapshot.description}
            </p>
          )}
        </div>
      </div>

      {/* Metadata Row: Author, Word Count, Timestamp */}
      <div className="mt-2.5 flex items-center justify-between text-[11px] text-[var(--text-faint)] border-t border-[var(--border-subtle)] pt-2">
        <div className="flex items-center gap-1.5 truncate mr-2">
          <div className="w-4 h-4 rounded-full bg-[var(--bg-raised)] border border-[var(--border-subtle)] flex items-center justify-center shrink-0">
            <User className="w-2.5 h-2.5 text-[var(--text-faint)]" />
          </div>
          <span className="truncate text-[var(--text-muted)] font-normal">{authorName}</span>
          {typeof snapshot.wordCount === "number" && (
            <>
              <span>•</span>
              <span className="font-mono">{snapshot.wordCount} words</span>
            </>
          )}
        </div>

        <span className="shrink-0 text-[10px] font-mono text-[var(--text-faint)]">{formattedDate}</span>
      </div>

      {/* Action Buttons */}
      <div className="mt-2.5 flex items-center gap-1.5 justify-end pt-1">
        <button
          type="button"
          onClick={() => onPreview(snapshot)}
          className={cn(
            "inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors border",
            isSelected
              ? "bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] border-[var(--accent)] shadow-2xs"
              : "bg-[var(--bg-raised)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] border-[var(--border-subtle)]"
          )}
          title="Preview this version"
        >
          <Eye className="w-3 h-3" />
          <span>{isSelected ? "Previewing" : "Preview"}</span>
        </button>

        {canRestore && (
          <button
            type="button"
            onClick={() => onRestore(snapshot)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium bg-[var(--bg-raised)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] transition-colors"
            title="Restore this version"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Restore</span>
          </button>
        )}
      </div>
    </div>
  );
}

