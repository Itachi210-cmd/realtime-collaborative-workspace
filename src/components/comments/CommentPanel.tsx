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
        if (onCommentsCountChange) {
          onCommentsCountChange(data.length);
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        const msg = err instanceof Error ? err.message : "Failed to load comments";
        setError(msg);
      } finally {
        setIsLoading(false);
      }
    },
    [workspaceId, pageId, onCommentsCountChange]
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
          if (onCommentsCountChange) {
            onCommentsCountChange(data.length);
          }
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
  }, [workspaceId, pageId, onCommentsCountChange]);

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
      setComments((prev) => {
        const next = [...prev, created];
        if (onCommentsCountChange) onCommentsCountChange(next.length);
        return next;
      });
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
    setComments((prev) => {
      const next = prev.filter((c) => c.id !== commentId);
      if (onCommentsCountChange) onCommentsCountChange(next.length);
      return next;
    });
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
    <div className="w-80 md:w-88 shrink-0 bg-white border-l border-[#e9e9e7] flex flex-col h-full overflow-hidden select-none">
      {/* Panel Header */}
      <div className="p-3 border-b border-[#e9e9e7] flex items-center justify-between shrink-0 bg-[#fbfbfa]">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-blue-600" />
          <h3 className="text-xs font-semibold text-[#37352f]">
            Comments ({comments.length})
          </h3>
          {unresolvedCount > 0 && (
            <span className="px-1.5 py-0.2 rounded-full bg-blue-100 text-blue-700 text-[10px] font-semibold">
              {unresolvedCount} open
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded text-neutral-400 hover:text-neutral-700 hover:bg-neutral-200/60 transition-colors"
          aria-label="Close comments"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Filter Tabs */}
      <div className="px-3 py-1.5 border-b border-[#e9e9e7]/70 flex items-center gap-1 bg-[#fbfbfa] text-[11px]">
        <Filter className="w-3 h-3 text-neutral-400 mr-1" />
        <button
          onClick={() => setFilter("all")}
          className={cn(
            "px-2 py-0.5 rounded transition-colors font-medium",
            filter === "all"
              ? "bg-white text-[#37352f] shadow-2xs border border-[#e5e7eb]"
              : "text-neutral-500 hover:text-neutral-800"
          )}
        >
          All
        </button>
        <button
          onClick={() => setFilter("unresolved")}
          className={cn(
            "px-2 py-0.5 rounded transition-colors font-medium",
            filter === "unresolved"
              ? "bg-white text-[#37352f] shadow-2xs border border-[#e5e7eb]"
              : "text-neutral-500 hover:text-neutral-800"
          )}
        >
          Open ({unresolvedCount})
        </button>
        <button
          onClick={() => setFilter("resolved")}
          className={cn(
            "px-2 py-0.5 rounded transition-colors font-medium",
            filter === "resolved"
              ? "bg-white text-[#37352f] shadow-2xs border border-[#e5e7eb]"
              : "text-neutral-500 hover:text-neutral-800"
          )}
        >
          Resolved ({comments.length - unresolvedCount})
        </button>
      </div>

      {/* Comments List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-12 text-neutral-400 text-xs gap-2">
            <Loader2 className="w-5 h-5 animate-spin text-neutral-400" />
            <span>Loading comments...</span>
          </div>
        ) : error ? (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600 flex flex-col gap-2">
            <span>{error}</span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => loadComments()}
              className="self-start text-[11px] h-6 px-2"
            >
              Retry
            </Button>
          </div>
        ) : filteredComments.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center text-neutral-400 space-y-2 px-4">
            <MessageSquare className="w-8 h-8 text-neutral-300 stroke-[1.5]" />
            <p className="text-xs text-neutral-500 font-medium">
              {filter === "all"
                ? "No comments yet. Start the discussion."
                : filter === "unresolved"
                ? "No open comments."
                : "No resolved comments."}
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
      <div className="p-3 border-t border-[#e9e9e7] bg-[#fbfbfa] shrink-0">
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
                className="w-full text-xs p-2.5 rounded-lg border border-[#e5e7eb] focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-[#2383e2] bg-white resize-none placeholder:text-neutral-400"
              />
            </div>
            <div className="flex items-center justify-between text-[10px] text-neutral-400">
              <span>{newCommentBody.length} / 2000</span>
              {submitError && (
                <span className="text-red-600 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  <span>{submitError}</span>
                </span>
              )}
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={isSubmitting || !newCommentBody.trim()}
                className="h-7 px-3 text-xs"
              >
                {isSubmitting ? (
                  <Loader2 className="w-3 h-3 animate-spin mr-1" />
                ) : (
                  <Send className="w-3 h-3 mr-1" />
                )}
                <span>Send</span>
              </Button>
            </div>
          </form>
        ) : (
          <div className="p-2.5 text-center text-xs text-neutral-400 bg-neutral-100/70 border border-neutral-200/70 rounded-lg">
            <span>You have view-only access and cannot post comments.</span>
          </div>
        )}
      </div>
    </div>
  );
}
