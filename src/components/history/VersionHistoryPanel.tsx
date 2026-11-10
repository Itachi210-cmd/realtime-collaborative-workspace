"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  History,
  X,
  Plus,
  RefreshCw,
  Loader2,
  AlertCircle,
  Clock,
  Bookmark,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import {
  VersionSummaryData,
  listPageVersions,
  createPageVersion,
} from "@/lib/api/history";
import { SnapshotItem } from "./SnapshotItem";

interface VersionHistoryPanelProps {
  workspaceId: string;
  pageId: string;
  isOpen: boolean;
  onClose: () => void;
  currentUserRole?: string;
  selectedVersionId: string | null;
  onSelectVersion: (version: VersionSummaryData | null) => void;
  onRequestRestore: (version: VersionSummaryData) => void;
  refreshTrigger?: number;
}

export function VersionHistoryPanel({
  workspaceId,
  pageId,
  isOpen,
  onClose,
  currentUserRole = "VIEWER",
  selectedVersionId,
  onSelectVersion,
  onRequestRestore,
  refreshTrigger = 0,
}: VersionHistoryPanelProps) {
  const { addToast } = useToast();

  const [versions, setVersions] = useState<VersionSummaryData[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Manual snapshot creation state
  const [isCreatingOpen, setIsCreatingOpen] = useState<boolean>(false);
  const [newLabel, setNewLabel] = useState<string>("");
  const [newDescription, setNewDescription] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const canManageVersions = currentUserRole === "OWNER" || currentUserRole === "EDITOR";

  // Load versions list
  const loadVersions = useCallback(
    async (signal?: AbortSignal) => {
      if (!workspaceId || !pageId) return;
      setIsLoading(true);
      setError(null);

      try {
        const data = await listPageVersions(workspaceId, pageId, signal);
        setVersions(data);
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        const msg = err instanceof Error ? err.message : "Failed to load version history";
        setError(msg);
      } finally {
        setIsLoading(false);
      }
    },
    [workspaceId, pageId]
  );

  // Fetch versions on mount, page switch, or refresh trigger
  useEffect(() => {
    let ignore = false;
    const controller = new AbortController();

    async function fetchList() {
      if (!workspaceId || !pageId) return;
      try {
        const data = await listPageVersions(workspaceId, pageId, controller.signal);
        if (!ignore) {
          setVersions(data);
          setError(null);
          setIsLoading(false);
        }
      } catch (err: unknown) {
        if (!ignore) {
          if (err instanceof DOMException && err.name === "AbortError") return;
          const msg = err instanceof Error ? err.message : "Failed to load version history";
          setError(msg);
          setIsLoading(false);
        }
      }
    }

    fetchList();

    return () => {
      ignore = true;
      controller.abort();
    };
  }, [workspaceId, pageId, refreshTrigger]);

  // Handle manual snapshot creation
  const handleCreateSnapshot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageVersions || isSubmitting) return;

    setIsSubmitting(true);
    setCreateError(null);

    try {
      const created = await createPageVersion(workspaceId, pageId, {
        label: newLabel.trim() || undefined,
        description: newDescription.trim() || undefined,
      });

      setVersions((prev) => [created, ...prev]);
      setNewLabel("");
      setDescription("");
      setIsCreatingOpen(false);
      addToast({
        message: "Version Saved",
        description: created.label
          ? `Saved "${created.label}" snapshot.`
          : "Saved version snapshot successfully.",
        variant: "success",
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to save version";
      setCreateError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const setDescription = (val: string) => {
    setNewDescription(val);
  };

  // Preview toggle: if already previewing this version, exit preview; otherwise select it
  const handleTogglePreview = (snapshot: VersionSummaryData) => {
    if (selectedVersionId === snapshot.id) {
      onSelectVersion(null);
    } else {
      onSelectVersion(snapshot);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="w-full sm:w-[380px] border-l border-[var(--border-subtle)] bg-[var(--bg-surface)] flex flex-col h-full shadow-lg lg:shadow-none animate-in slide-in-from-right duration-150 select-none">
      {/* Header */}
      <div className="p-3.5 border-b border-[var(--border-subtle)] flex items-center justify-between bg-[var(--bg-surface)] shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-md bg-[var(--bg-raised)] text-[var(--text-muted)] flex items-center justify-center shrink-0 border border-[var(--border-subtle)]">
            <History className="w-3.5 h-3.5" />
          </div>
          <div>
            <h2 className="text-xs font-medium text-[var(--text-primary)]">Version History</h2>
            <p className="text-[10px] text-[var(--text-faint)] font-mono">
              {versions.length} {versions.length === 1 ? "version" : "versions"} saved
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => loadVersions()}
            disabled={isLoading}
            className="p-1.5 text-[var(--text-faint)] hover:text-[var(--text-primary)] rounded-md hover:bg-[var(--bg-hover)] transition-colors disabled:opacity-50"
            title="Refresh history"
            aria-label="Refresh history"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-[var(--text-faint)] hover:text-[var(--text-primary)] rounded-md hover:bg-[var(--bg-hover)] transition-colors"
            title="Close history panel"
            aria-label="Close history panel"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Create Version Button / Section (OWNER & EDITOR only) */}
      {canManageVersions && (
        <div className="p-3 border-b border-[var(--border-subtle)] bg-[var(--bg-raised)]/40 shrink-0">
          {!isCreatingOpen ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setIsCreatingOpen(true)}
              className="w-full justify-center text-xs h-8 gap-1.5 border border-[var(--border-subtle)] hover:border-[var(--border-strong)] bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Save Current Version</span>
            </Button>
          ) : (
            <form onSubmit={handleCreateSnapshot} className="space-y-2.5">
              <div className="flex items-center justify-between text-xs font-medium text-[var(--text-primary)]">
                <span className="flex items-center gap-1.5">
                  <Bookmark className="w-3.5 h-3.5 text-[var(--accent)]" />
                  <span>New Snapshot</span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setIsCreatingOpen(false);
                    setCreateError(null);
                  }}
                  className="text-[var(--text-faint)] hover:text-[var(--text-muted)] text-[11px]"
                >
                  Cancel
                </button>
              </div>

              <div>
                <input
                  type="text"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder="Snapshot label (e.g. Pre-launch draft)"
                  maxLength={100}
                  disabled={isSubmitting}
                  className="w-full text-xs px-2.5 py-1.5 rounded-md border border-[var(--border-subtle)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)] focus:border-[var(--accent)] bg-[var(--bg-surface)] text-[var(--text-primary)] placeholder:text-[var(--text-faint)]"
                />
              </div>

              <div>
                <textarea
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="Description or notes (optional)"
                  maxLength={500}
                  rows={2}
                  disabled={isSubmitting}
                  className="w-full text-xs px-2.5 py-1.5 rounded-md border border-[var(--border-subtle)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)] focus:border-[var(--accent)] bg-[var(--bg-surface)] text-[var(--text-primary)] placeholder:text-[var(--text-faint)] resize-none"
                />
              </div>

              {createError && (
                <div className="flex items-center gap-1 text-[11px] text-red-600 dark:text-red-400">
                  <AlertCircle className="w-3 h-3 shrink-0" />
                  <span>{createError}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-1.5">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setIsCreatingOpen(false)}
                  disabled={isSubmitting}
                  className="h-7 text-xs px-2.5 bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-[var(--border-subtle)]"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={isSubmitting}
                  className="h-7 text-xs px-3 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white gap-1 border-transparent"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-3 h-3 animate-spin" />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <span>Save Version</span>
                  )}
                </Button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* Snapshot List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {isLoading ? (
          <div className="space-y-2 py-4">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="p-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] animate-pulse space-y-2"
              >
                <div className="flex justify-between">
                  <div className="h-3 w-32 bg-[var(--bg-hover)] rounded" />
                  <div className="h-3 w-12 bg-[var(--bg-hover)] rounded" />
                </div>
                <div className="h-2.5 w-48 bg-[var(--bg-hover)] rounded" />
                <div className="h-2 w-24 bg-[var(--bg-hover)] rounded" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-600 dark:text-red-400 flex flex-col gap-2">
            <span>{error}</span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => loadVersions()}
              className="self-start text-[11px] h-6 px-2 bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-subtle)]"
            >
              Retry
            </Button>
          </div>
        ) : versions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center text-[var(--text-faint)] space-y-2 px-4">
            <Clock className="w-8 h-8 text-[var(--text-faint)] stroke-[1.5]" />
            <p className="text-xs text-[var(--text-muted)] font-medium">No versions saved yet</p>
            <p className="text-[11px] text-[var(--text-faint)] max-w-[240px]">
              {canManageVersions
                ? "Click 'Save Current Version' above to create a named snapshot. Automatic checkpoints are also saved before any restoration."
                : "No version snapshots have been saved for this document yet."}
            </p>
          </div>
        ) : (
          versions.map((snapshot) => (
            <SnapshotItem
              key={snapshot.id}
              snapshot={snapshot}
              isSelected={selectedVersionId === snapshot.id}
              canRestore={canManageVersions}
              onPreview={handleTogglePreview}
              onRestore={onRequestRestore}
            />
          ))
        )}
      </div>

      {/* Footer Info */}
      <div className="p-2.5 border-t border-[var(--border-subtle)] bg-[var(--bg-raised)]/40 text-center text-[10px] text-[var(--text-faint)] shrink-0">
        <span>Click Preview to view historical contents without altering the active document.</span>
      </div>
    </div>
  );
}
