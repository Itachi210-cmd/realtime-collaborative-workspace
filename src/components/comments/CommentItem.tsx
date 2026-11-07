"use client";

import React, { useState } from "react";
import {
  CheckCircle2,
  Circle,
  MoreVertical,
  Edit2,
  Trash2,
  Check,
  X,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { CommentItemData } from "@/lib/api/comments";
import { Dialog } from "@/components/ui/Dialog";

interface CommentItemProps {
  comment: CommentItemData;
  currentUserId?: string;
  currentUserRole?: string;
  onEdit: (commentId: string, newBody: string) => Promise<void>;
  onToggleResolve: (commentId: string, resolved: boolean) => Promise<void>;
  onDelete: (commentId: string) => Promise<void>;
}

export function CommentItem({
  comment,
  currentUserId,
  currentUserRole = "VIEWER",
  onEdit,
  onToggleResolve,
  onDelete,
}: CommentItemProps) {
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [editText, setEditText] = useState<string>(comment.body);
  const [isSavingEdit, setIsSavingEdit] = useState<boolean>(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [isTogglingResolve, setIsTogglingResolve] = useState<boolean>(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<boolean>(false);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [showMenu, setShowMenu] = useState<boolean>(false);

  const isAuthor = Boolean(currentUserId && currentUserId === comment.authorId);
  const isOwner = currentUserRole === "OWNER";
  const isEditor = currentUserRole === "EDITOR";
  const isCommenter = currentUserRole === "COMMENTER";
  const isViewer = currentUserRole === "VIEWER";

  // Permissions according to Step 1 & Step 2 requirements:
  // - Author can edit own comment
  const canEdit = isAuthor && !isViewer;

  // - Author, EDITOR, OWNER can resolve/unresolve
  // - COMMENTER cannot resolve another member's comment
  // - VIEWER cannot resolve
  const canResolve =
    !isViewer && (isOwner || isEditor || (isCommenter && isAuthor));

  // - Author can delete own comment
  // - OWNER can delete any comment
  // - Other users must not see delete actions
  const canDelete = isAuthor || isOwner;

  const isResolved = Boolean(comment.resolvedAt);
  const isEdited =
    new Date(comment.updatedAt).getTime() - new Date(comment.createdAt).getTime() > 2000;

  const initials = comment.author?.name
    ? comment.author.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "A";

  const handleSaveEdit = async () => {
    const trimmed = editText.trim();
    if (!trimmed) {
      setEditError("Comment cannot be empty.");
      return;
    }
    if (trimmed.length > 2000) {
      setEditError("Comment cannot exceed 2000 characters.");
      return;
    }

    setIsSavingEdit(true);
    setEditError(null);
    try {
      await onEdit(comment.id, trimmed);
      setIsEditing(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to update comment";
      setEditError(msg);
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleToggleResolveClick = async () => {
    if (!canResolve || isTogglingResolve) return;
    setIsTogglingResolve(true);
    try {
      await onToggleResolve(comment.id, !isResolved);
    } catch {
      // Error handled by parent
    } finally {
      setIsTogglingResolve(false);
    }
  };

  const handleConfirmDelete = async () => {
    setIsDeleting(true);
    try {
      await onDelete(comment.id);
      setShowDeleteConfirm(false);
    } catch {
      // Error handled by parent
    } finally {
      setIsDeleting(false);
    }
  };

  const formattedDate = new Date(comment.createdAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <>
      <div
        className={cn(
          "group relative p-3 rounded-lg border transition-colors",
          isResolved
            ? "bg-neutral-50/70 border-neutral-200/60 opacity-80"
            : "bg-white border-[#e9e9e7] hover:border-[#d0d0ce]"
        )}
      >
        {/* Comment Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 font-semibold text-[10px] flex items-center justify-center shrink-0">
              {initials}
            </div>
            <div className="min-w-0">
              <span className="text-xs font-semibold text-[#37352f] truncate block">
                {comment.author?.name || "Author"}
              </span>
              <div className="flex items-center gap-1.5 text-[10px] text-neutral-400">
                <span>{formattedDate}</span>
                {isEdited && <span>• (edited)</span>}
              </div>
            </div>
          </div>

          {/* Right Action Icons: Resolve toggle + Menu */}
          <div className="flex items-center gap-1 shrink-0">
            {canResolve && (
              <button
                onClick={handleToggleResolveClick}
                disabled={isTogglingResolve}
                className={cn(
                  "p-1 rounded transition-colors",
                  isResolved
                    ? "text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                    : "text-neutral-400 hover:text-emerald-600 hover:bg-neutral-100"
                )}
                title={isResolved ? "Mark as unresolved" : "Mark as resolved"}
                aria-label={isResolved ? "Mark as unresolved" : "Mark as resolved"}
              >
                {isTogglingResolve ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : isResolved ? (
                  <CheckCircle2 className="w-3.5 h-3.5" />
                ) : (
                  <Circle className="w-3.5 h-3.5" />
                )}
              </button>
            )}

            {(canEdit || canDelete) && (
              <div className="relative">
                <button
                  onClick={() => setShowMenu((prev) => !prev)}
                  className="p-1 rounded text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors"
                  aria-label="Comment options"
                >
                  <MoreVertical className="w-3.5 h-3.5" />
                </button>

                {showMenu && (
                  <>
                    <div
                      className="fixed inset-0 z-20"
                      onClick={() => setShowMenu(false)}
                    />
                    <div className="absolute right-0 top-full mt-1 z-30 w-28 bg-white border border-[#e9e9e7] rounded-md shadow-md py-1 text-xs">
                      {canEdit && (
                        <button
                          onClick={() => {
                            setShowMenu(false);
                            setEditText(comment.body);
                            setIsEditing(true);
                          }}
                          className="w-full px-2.5 py-1 text-left flex items-center gap-1.5 text-neutral-600 hover:bg-neutral-100 hover:text-[#37352f]"
                        >
                          <Edit2 className="w-3 h-3" />
                          <span>Edit</span>
                        </button>
                      )}
                      {canDelete && (
                        <button
                          onClick={() => {
                            setShowMenu(false);
                            setShowDeleteConfirm(true);
                          }}
                          className="w-full px-2.5 py-1 text-left flex items-center gap-1.5 text-red-600 hover:bg-red-50"
                        >
                          <Trash2 className="w-3 h-3" />
                          <span>Delete</span>
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Comment Body */}
        {isEditing ? (
          <div className="mt-2 space-y-2">
            <textarea
              value={editText}
              onChange={(e) => {
                setEditText(e.target.value);
                if (editError) setEditError(null);
              }}
              disabled={isSavingEdit}
              maxLength={2000}
              rows={3}
              className="w-full text-xs p-2 rounded border border-[#e5e7eb] focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-[#2383e2] resize-none"
              placeholder="Edit your comment..."
            />
            <div className="flex items-center justify-between text-[10px] text-neutral-400">
              <span>{editText.length} / 2000</span>
              {editError && <span className="text-red-600">{editError}</span>}
              <div className="flex items-center gap-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsEditing(false)}
                  disabled={isSavingEdit}
                  className="h-6 px-2 text-[11px]"
                >
                  <X className="w-3 h-3 mr-1" />
                  <span>Cancel</span>
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleSaveEdit}
                  disabled={isSavingEdit || !editText.trim()}
                  className="h-6 px-2 text-[11px]"
                >
                  {isSavingEdit ? (
                    <Loader2 className="w-3 h-3 animate-spin mr-1" />
                  ) : (
                    <Check className="w-3 h-3 mr-1" />
                  )}
                  <span>Save</span>
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-1.5 text-xs text-[#37352f] whitespace-pre-wrap break-words leading-relaxed">
            {comment.body}
          </div>
        )}

        {/* Resolved Badge */}
        {isResolved && (
          <div className="mt-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 text-[10px] font-medium border border-emerald-200">
            <CheckCircle2 className="w-2.5 h-2.5" />
            <span>Resolved</span>
          </div>
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      {showDeleteConfirm && (
        <Dialog
          isOpen={showDeleteConfirm}
          onClose={() => setShowDeleteConfirm(false)}
          title="Delete Comment"
          description="Are you sure you want to permanently delete this comment? This action cannot be undone."
          footer={
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={isDeleting}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={handleConfirmDelete}
                disabled={isDeleting}
              >
                {isDeleting ? "Deleting..." : "Delete"}
              </Button>
            </div>
          }
          maxWidth="sm"
        >
          <div className="text-xs text-neutral-500 py-2">
            The comment will be immediately removed from this document.
          </div>
        </Dialog>
      )}
    </>
  );
}

