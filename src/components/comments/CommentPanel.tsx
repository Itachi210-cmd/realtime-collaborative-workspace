"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  MessageSquare,
  X,
  Send,
  Loader2,
  AlertCircle,
  Filter,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { CommentItem } from "./CommentItem";
import {
  CommentItemData,
  getPageComments,
  createComment,
  updateComment,
  deleteComment,
} from "@/lib/api/comments";
import { useToast } from "@/components/ui/Toast";

interface CommentPanelProps {
  workspaceId: string;
  pageId: string;
  isOpen: boolean;
  onClose: () => void;
  currentUserId?: string;
  currentUserRole?: string;
  onCommentsCountChange?: (count: number) => void;
}

export function CommentPanel({
  workspaceId,
  pageId,
  isOpen,
  onClose,
  currentUserId,
  currentUserRole = "VIEWER",
  onCommentsCountChange,
}: CommentPanelProps) {
  const { addToast } = useToast();

  const [comments, setComments] = useState<CommentItemData[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Filter state: "all" | "unresolved" | "resolved"
  const [filter, setFilter] = useState<"all" | "unresolved" | "resolved">("all");

  // New comment composer state
  const [newCommentBody, setNewCommentBody] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isViewer = currentUserRole === "VIEWER";
  const canPostComment = !isViewer; // OWNER, EDITOR, COMMENTER can post

  // Load comments for current page
  const loadComments = useCallback(
    async (signal?: AbortSignal) => {
      if (!workspaceId || !pageId) return;
      setIsLoading(true);
      setError(null);
      setComments([]);

      try {
        const data = await getPageComments(workspaceId, pageId, signal);
        setComments(data);
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        const msg = err instanceof Error ? err.message : "Failed to load comments";
        setError(msg);
      } finally {
        setIsLoading(false);
      }
    },
    [workspaceId, pageId]
  );

  // Fetch comments when pageId or workspaceId changes
  useEffect(() => {
    let ignore = false;
    const controller = new AbortController();

    async function fetchComments() {
      if (!workspaceId || !pageId) return;
      try {
        const data = await getPageComments(workspaceId, pageId, controller.signal);
        if (!ignore) {
          setComments(data);
          setError(null);
          setIsLoading(false);
        }
      } catch (err: unknown) {
        if (!ignore) {
          if (err instanceof DOMException && err.name === "AbortError") return;
          const msg = err instanceof Error ? err.message : "Failed to load comments";
          setError(msg);
          setIsLoading(false);
        }
      }
    }

    fetchComments();

    return () => {
      ignore = true;
      controller.abort();
    };
  }, [workspaceId, pageId]);

  // Safely notify parent of comments count changes in effect phase (preventing render-phase cross-component updates)
  const lastReportedCountRef = useRef<number | null>(null);
  useEffect(() => {
    if (!isLoading && lastReportedCountRef.current !== comments.length) {
      lastReportedCountRef.current = comments.length;
      onCommentsCountChange?.(comments.length);
    }
  }, [comments.length, isLoading, onCommentsCountChange]);

  // Handle post new comment
  const handleSubmitComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canPostComment || isSubmitting) return;

    const trimmed = newCommentBody.trim();
    if (!trimmed) {
      setSubmitError("Comment body cannot be empty.");
      return;
    }
    if (trimmed.length > 2000) {
      setSubmitError("Comment cannot exceed 2000 characters.");
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const created = await createComment(workspaceId, pageId, trimmed);
      setComments((prev) => [...prev, created]);
      setNewCommentBody("");
      addToast({
        message: "Comment added",
        variant: "success",
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to post comment";
      setSubmitError(msg);
      addToast({
        message: "Error posting comment",
        description: msg,
        variant: "error",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle edit comment
  const handleEditComment = async (commentId: string, newBody: string) => {
    const updated = await updateComment(workspaceId, pageId, commentId, { body: newBody });
    setComments((prev) =>
      prev.map((c) => (c.id === commentId ? { ...c, body: updated.body, updatedAt: updated.updatedAt } : c))
    );
    addToast({
      message: "Comment updated",
      variant: "success",
    });
  };

  // Handle resolve toggle
  const handleToggleResolve = async (commentId: string, resolved: boolean) => {
    const updated = await updateComment(workspaceId, pageId, commentId, { resolved });
    setComments((prev) =>
      prev.map((c) => (c.id === commentId ? { ...c, resolvedAt: updated.resolvedAt } : c))
    );
    addToast({
      message: resolved ? "Comment resolved" : "Comment marked unresolved",
      variant: "info",
    });
  };

  // Handle delete comment
  const handleDeleteComment = async (commentId: string) => {
    await deleteComment(workspaceId, pageId, commentId);
    setComments((prev) => prev.filter((c) => c.id !== commentId));
    addToast({
      message: "Comment deleted",
      variant: "info",
    });
  };

  // Filtered comments
  const filteredComments = comments.filter((c) => {
    if (filter === "unresolved") return !c.resolvedAt;
    if (filter === "resolved") return Boolean(c.resolvedAt);
    return true;
  });

  const unresolvedCount = comments.filter((c) => !c.resolvedAt).length;

  if (!isOpen) return null;

  return (
    <div className="w-80 sm:w-88 shrink-0 bg-[var(--bg-surface)] border-l border-[var(--border-subtle)] flex flex-col h-full overflow-hidden select-none">
      {/* Panel Header */}
      <div className="p-3 sm:p-3.5 border-b border-[var(--border-subtle)] flex items-center justify-between shrink-0 bg-[var(--bg-surface)]">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-[var(--text-muted)]" />
          <h3 className="text-xs font-medium text-[var(--text-primary)]">
            Comments ({comments.length})
          </h3>
          {unresolvedCount > 0 && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-[var(--accent-light)] text-[var(--accent)] border border-[var(--accent-border)]/40">
              {unresolvedCount} open
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-md text-[var(--text-faint)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
          aria-label="Close comments"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Filter Tabs */}
      <div className="px-3 py-1.5 border-b border-[var(--border-subtle)] flex items-center gap-1 bg-[var(--bg-raised)]/60 text-[11px]">
        <Filter className="w-3 h-3 text-[var(--text-faint)] mr-1" />
        <button
          onClick={() => setFilter("all")}
          className={cn(
            "px-2 py-0.5 rounded transition-colors font-medium",
            filter === "all"
              ? "bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-2xs border border-[var(--border-subtle)]"
              : "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
          )}
        >
          All
        </button>
        <button
          onClick={() => setFilter("unresolved")}
          className={cn(
            "px-2 py-0.5 rounded transition-colors font-medium",
            filter === "unresolved"
              ? "bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-2xs border border-[var(--border-subtle)]"
              : "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
          )}
        >
          Open ({unresolvedCount})
        </button>
        <button
          onClick={() => setFilter("resolved")}
          className={cn(
            "px-2 py-0.5 rounded transition-colors font-medium",
            filter === "resolved"
              ? "bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-2xs border border-[var(--border-subtle)]"
              : "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
          )}
        >
          Resolved ({comments.length - unresolvedCount})
        </button>
      </div>

      {/* Comments List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-12 text-[var(--text-faint)] text-xs gap-2">
            <Loader2 className="w-5 h-5 animate-spin text-[var(--text-faint)]" />
            <span>Loading comments...</span>
          </div>
        ) : error ? (
          <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-600 dark:text-red-400 flex flex-col gap-2">
            <span>{error}</span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => loadComments()}
              className="self-start text-[11px] h-6 px-2 bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-subtle)]"
            >
              Retry
            </Button>
          </div>
        ) : filteredComments.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center text-[var(--text-faint)] space-y-2 px-4">
            <MessageSquare className="w-6 h-6 text-[var(--text-faint)] stroke-[1.5]" />
            <p className="text-xs text-[var(--text-muted)] font-medium">
              {filter === "all"
                ? "No comments on this document"
                : filter === "unresolved"
                ? "No open comments"
                : "No resolved comments"}
            </p>
            <p className="text-[11px] text-[var(--text-faint)] max-w-[220px]">
              Editorial margin notes and discussion will appear here.
            </p>
          </div>
        ) : (
          filteredComments.map((comment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              currentUserId={currentUserId}
              currentUserRole={currentUserRole}
              onEdit={handleEditComment}
              onToggleResolve={handleToggleResolve}
              onDelete={handleDeleteComment}
            />
          ))
        )}
      </div>

      {/* Composer Section */}
      <div className="p-3 border-t border-[var(--border-subtle)] bg-[var(--bg-raised)]/40 shrink-0">
        {canPostComment ? (
          <form onSubmit={handleSubmitComment} className="space-y-2">
            <div className="relative">
              <textarea
                ref={textareaRef}
                value={newCommentBody}
                onChange={(e) => {
                  setNewCommentBody(e.target.value);
                  if (submitError) setSubmitError(null);
                }}
                disabled={isSubmitting}
                maxLength={2000}
                rows={2}
                placeholder="Write a comment..."
                className="w-full text-xs p-2.5 rounded-md border border-[var(--border-subtle)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)] focus:border-[var(--accent)] bg-[var(--bg-surface)] text-[var(--text-primary)] resize-none placeholder:text-[var(--text-faint)]"
              />
            </div>
            <div className="flex items-center justify-between text-[10px] text-[var(--text-faint)]">
              <span className="font-mono">{newCommentBody.length} / 2000</span>
              {submitError && (
                <span className="text-red-600 dark:text-red-400 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  <span>{submitError}</span>
                </span>
              )}
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={isSubmitting || !newCommentBody.trim()}
                className="h-7 px-3 text-xs bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white border-transparent"
              >
                {isSubmitting ? (
                  <Loader2 className="w-3 h-3 animate-spin mr-1" />
                ) : (
                  <Send className="w-3 h-3 mr-1" />
                )}
                <span>Comment</span>
              </Button>
            </div>
          </form>
        ) : (
          <div className="p-2.5 text-center text-xs text-[var(--text-muted)] bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-md">
            <span>You have view-only access and cannot post comments.</span>
          </div>
        )}
      </div>
    </div>
  );
}
