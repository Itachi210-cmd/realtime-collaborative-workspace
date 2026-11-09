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
        "group relative p-3 rounded-lg border transition-all text-left",
        isSelected
          ? "bg-blue-50/70 border-blue-300 shadow-2xs ring-1 ring-blue-400/30"
          : "bg-white border-[#e9e9e7] hover:border-neutral-300 hover:shadow-2xs"
      )}
    >
      {/* Header: Label & Type Badge */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span
              className={cn(
                "text-xs font-semibold truncate",
                isSelected ? "text-blue-900" : "text-[#37352f]"
              )}
            >
              {snapshot.label || (snapshot.isAutomatic ? "Automatic Checkpoint" : "Saved Version")}
            </span>

            {snapshot.isAutomatic ? (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200/80">
                <ShieldAlert className="w-2.5 h-2.5" />
                <span>Recovery</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-600 border border-blue-200/60">
                <Clock className="w-2.5 h-2.5" />
                <span>Manual</span>
              </span>
            )}
          </div>

          {snapshot.description && (
            <p className="text-[11px] text-neutral-500 mt-1 line-clamp-2">
              {snapshot.description}
            </p>
          )}
        </div>
      </div>

      {/* Metadata Row: Author, Word Count, Timestamp */}
      <div className="mt-2.5 flex items-center justify-between text-[11px] text-neutral-400 border-t border-neutral-100 pt-2">
        <div className="flex items-center gap-1.5 truncate mr-2">
          <div className="w-4 h-4 rounded-full bg-neutral-100 border border-neutral-200 flex items-center justify-center shrink-0">
            <User className="w-2.5 h-2.5 text-neutral-500" />
          </div>
          <span className="truncate text-neutral-600 font-medium">{authorName}</span>
          {typeof snapshot.wordCount === "number" && (
            <>
              <span>•</span>
              <span>{snapshot.wordCount} words</span>
            </>
          )}
        </div>

        <span className="shrink-0 text-[10px] text-neutral-400">{formattedDate}</span>
      </div>

      {/* Action Buttons */}
      <div className="mt-2.5 flex items-center gap-1.5 justify-end pt-1">
        <button
          type="button"
          onClick={() => onPreview(snapshot)}
          className={cn(
            "inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors",
            isSelected
              ? "bg-blue-600 text-white hover:bg-blue-700 shadow-2xs"
              : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"
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
            className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium bg-neutral-100 text-neutral-700 hover:bg-neutral-200 hover:text-neutral-900 transition-colors"
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

