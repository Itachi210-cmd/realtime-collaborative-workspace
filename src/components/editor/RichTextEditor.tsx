"use client";

import React, { useState, useRef, useMemo, useEffect, useCallback, useSyncExternalStore } from "react";
import { useEditor, EditorContent, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Collaboration from "@tiptap/extension-collaboration";
import { CollaborationCursor } from "@/lib/collab/collaboration-cursor";
import * as Y from "yjs";
import * as awarenessProtocol from "y-protocols/awareness";
import { Eye, MessageSquare, Clock, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { EditorToolbar } from "./EditorToolbar";
import { DocumentTitle } from "./DocumentTitle";
import { CollabStatusBadge } from "./CollabStatusBadge";
import { CollaboratorAvatars } from "./CollaboratorAvatars";
import { SaveStatusBadge, type SaveStatus } from "./SaveStatusBadge";
import { CommentPanel } from "@/components/comments/CommentPanel";
import { VersionHistoryPanel } from "@/components/history/VersionHistoryPanel";
import { RestoreConfirmationDialog } from "@/components/history/RestoreConfirmationDialog";
import { ReadOnlyPreview } from "@/components/history/ReadOnlyPreview";
import { useToast } from "@/components/ui/Toast";
import { getPageComments } from "@/lib/api/comments";
import {
  VersionSummaryData,
  VersionDetailData,
  getPageVersion,
  restorePageVersion,
} from "@/lib/api/history";
import { getCollaboratorColor } from "@/lib/collab/collab-colors";
import {
  createCollabWebsocketProvider,
  type CollabConnectionStatus,
  type CollabWebsocketProvider,
  type SaveStatusDetails,
} from "@/lib/collab/collab-provider";
import { useRouter } from "next/navigation";

export interface CurrentEditorUser {
  id: string;
  name: string;
  email?: string;
  role?: string;
}

interface RichTextEditorProps {
  workspaceId: string;
  pageId: string;
  initialTitle: string;
  initialContent?: JSONContent | null;
  isEditable?: boolean;
  currentUser?: CurrentEditorUser | null;
  authorName?: string;
  updatedAt?: string | Date;
  parentPage?: { id: string; title: string } | null;
}

export function RichTextEditor({
  workspaceId,
  pageId,
  initialTitle,
  initialContent: _initialContent,
  isEditable = true,
  currentUser,
  authorName,
  updatedAt,
  parentPage,
}: RichTextEditorProps) {
  const router = useRouter();

  // Formatted publication date
  const formattedDate = useMemo(() => {
    if (!updatedAt) return new Date().toLocaleDateString();
    return new Date(updatedAt).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }, [updatedAt]);

  // React 19 idiomatic SSR / hydration safe client mounting
  const isMounted = useSyncExternalStore(
    () => () => { },
    () => true,
    () => false
  );

  const [collabStatus, setCollabStatus] = useState<CollabConnectionStatus>("connecting");
  const [collabError, setCollabError] = useState<string | null>(null);
  const [isSynced, setIsSynced] = useState<boolean>(false);
  const [serverSaveStatus, setServerSaveStatus] = useState<"saved" | "saving" | "error">("saved");
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);

  // Comments panel state
  const [isCommentsOpen, setIsCommentsOpen] = useState<boolean>(false);
  const [commentsCount, setCommentsCount] = useState<number>(0);

  // Version history state
  const { addToast } = useToast();
  const [isHistoryOpen, setIsHistoryOpen] = useState<boolean>(false);
  const [previewVersion, setPreviewVersion] = useState<VersionDetailData | null>(null);
  const [restoreTargetSnapshot, setRestoreTargetSnapshot] = useState<VersionSummaryData | null>(null);
  const [isRestoring, setIsRestoring] = useState<boolean>(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [historyRefreshKey, setHistoryRefreshKey] = useState<number>(0);

  // Version preview selection handler
  const handleSelectVersionForPreview = useCallback(
    async (snapshot: VersionSummaryData | null) => {
      if (!snapshot) {
        setPreviewVersion(null);
        return;
      }
      try {
        const detail = await getPageVersion(workspaceId, pageId, snapshot.id);
        setPreviewVersion(detail);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to load snapshot preview";
        addToast({
          message: "Preview Error",
          description: msg,
          variant: "error",
        });
        setPreviewVersion(null);
      }
    },
    [workspaceId, pageId, addToast]
  );

  // Snapshot restore confirmation handler
  const handleConfirmRestore = useCallback(async () => {
    if (!restoreTargetSnapshot) return;
    setIsRestoring(true);
    setRestoreError(null);
    try {
      await restorePageVersion(workspaceId, pageId, restoreTargetSnapshot.id);
      addToast({
        message: "Document Restored",
        description: `Successfully restored to version from ${new Date(
          restoreTargetSnapshot.createdAt
        ).toLocaleDateString()}.`,
        variant: "success",
      });
      setRestoreTargetSnapshot(null);
      setPreviewVersion(null);
      setHistoryRefreshKey((prev) => prev + 1);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to restore document version.";
      setRestoreError(msg);
    } finally {
      setIsRestoring(false);
    }
  }, [workspaceId, pageId, restoreTargetSnapshot, addToast]);

  // Monotonic tracking of local user edits to prevent stale acknowledgements
  const localEditCountRef = useRef<number>(0);
  const lastAcknowledgedEditCountRef = useRef<number>(0);
  const [hasPendingLocalEdits, setHasPendingLocalEdits] = useState<boolean>(false);

  // Deterministically assign accessible color based on authenticated userId
  const userColor = useMemo(() => {
    return getCollaboratorColor(currentUser?.id);
  }, [currentUser?.id]);

  // Maintain stable Y.Doc per pageId (in-memory CRDT, garbage collected on page switch)
  const ydoc = useMemo(() => {
    void pageId;
    return new Y.Doc();
  }, [pageId]);

  // Maintain stable Yjs Awareness instance bound to ydoc
  const awareness = useMemo(() => {
    return new awarenessProtocol.Awareness(ydoc);
  }, [ydoc]);

  // Set local user details in awareness
  useEffect(() => {
    if (!awareness || !currentUser) return;
    awareness.setLocalStateField("user", {
      id: currentUser.id,
      name: currentUser.name,
      email: currentUser.email,
      color: userColor.hex,
      role: currentUser.role,
    });
  }, [awareness, currentUser, userColor]);

  const providerRef = useRef<CollabWebsocketProvider | null>(null);

  // Fetch initial comments count on mount or page switch
  useEffect(() => {
    let active = true;
    async function loadCount() {
      try {
        const comments = await getPageComments(workspaceId, pageId);
        if (active) {
          setCommentsCount(comments.length);
        }
      } catch {
        // Ignore silent count fetch error
      }
    }
    loadCount();
    return () => {
      active = false;
    };
  }, [workspaceId, pageId]);

  // Track local editor updates to ensure status immediately shows "saving" and avoids stale acknowledgements
  useEffect(() => {
    if (!isEditable || !ydoc) return;

    const handleDocUpdate = (_update: Uint8Array, origin: unknown) => {
      // If the update originated from the WebSocket sync or initial persistence load, do not mark as local pending edit
      if (origin === providerRef.current || origin === "persistence") {
        return;
      }
      localEditCountRef.current += 1;
      setHasPendingLocalEdits(true);
      setServerSaveStatus("saving");
    };

    ydoc.on("update", handleDocUpdate);
    return () => {
      ydoc.off("update", handleDocUpdate);
    };
  }, [ydoc, isEditable]);

  // Manage WebSocket provider lifecycle for ALL roles (Model B: COMMENTER & VIEWER sync real-time doc & presence)
  useEffect(() => {
    if (!isMounted) return;

    const collabProvider = createCollabWebsocketProvider({
      workspaceId,
      pageId,
      ydoc,
      awareness,
      onStatusChange: (status, err) => {
        setCollabStatus(status as CollabConnectionStatus);
        setCollabError(err || null);
      },
      onSaveStatusChange: (status, details?: SaveStatusDetails) => {
        if (status === "saved") {
          // Document persistence acknowledged by server
          lastAcknowledgedEditCountRef.current = localEditCountRef.current;
          setHasPendingLocalEdits(false);
          setServerSaveStatus("saved");
          setSaveErrorMessage(null);
        } else if (status === "saving") {
          setServerSaveStatus("saving");
        } else if (status === "error") {
          setServerSaveStatus("error");
          setSaveErrorMessage(details?.error || "Save failed. Changes pending retry.");
        }
      },
      onSyncChange: (synced: boolean) => {
        setIsSynced(synced);
      },
    });

    providerRef.current = collabProvider;

    return () => {
      collabProvider.destroy();
      providerRef.current = null;
    };
  }, [isMounted, workspaceId, pageId, ydoc, awareness]);

  // Unified document persistence & sync status state machine
  const currentDocStatus: SaveStatus = useMemo(() => {
    // 1. Connection-level states take precedence for all roles
    if (collabStatus === "connecting") return "connecting";
    if (collabStatus === "reconnecting") return "reconnecting";
    if (collabStatus === "disconnected") return "offline";
    if (collabStatus === "auth_error") return "error";

    // 2. Initial Yjs sync pending
    if (!isSynced) return "syncing";

    // Read-only viewers and commenters do not make editable changes
    if (!isEditable) return "saved";

    // 3. Storage / persistence error
    if (serverSaveStatus === "error") return "error";

    // 4. Persistence in flight or local edits unacknowledged
    if (serverSaveStatus === "saving" || hasPendingLocalEdits) {
      return "saving";
    }

    // 5. Confirmed persisted in PostgreSQL
    return "saved";
  }, [isEditable, collabStatus, isSynced, serverSaveStatus, hasPendingLocalEdits]);

  // Retry handler for connection and persistence errors
  const handleRetrySave = useCallback(() => {
    if (collabStatus === "auth_error" || collabStatus === "disconnected") {
      providerRef.current?.connect();
    } else if (serverSaveStatus === "error") {
      setServerSaveStatus("saving");
      setSaveErrorMessage(null);
      if (providerRef.current?.retrySave) {
        providerRef.current.retrySave();
      }
    }
  }, [collabStatus, serverSaveStatus]);

  // Initialize TipTap with Collaboration and CollaborationCursor extensions
  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          // TipTap 3 StarterKit uses undoRedo to control built-in history; Yjs handles collaborative history
          undoRedo: false,
          heading: {
            levels: [1, 2, 3],
          },
          link: {
            openOnClick: false,
            autolink: true,
            HTMLAttributes: {
              class:
                "text-[var(--accent)] underline underline-offset-2 hover:text-[var(--accent-hover)] cursor-pointer",
            },
          },
          underline: {},
        }),
        Placeholder.configure({
          placeholder: isEditable ? "Press '/' for commands, or start typing..." : "",
          emptyEditorClass: "is-editor-empty",
        }),
        Collaboration.configure({
          document: ydoc,
          field: "default",
        }),
        CollaborationCursor.configure({
          provider: { awareness },
          user: {
            name: currentUser?.name || "Anonymous",
            color: userColor.hex,
          },
        }),
      ],
      // When collaboration is active, Y.Doc is the source of truth
      editable: isEditable,
      immediatelyRender: false,
      editorProps: {
        attributes: {
          class:
            "prose prose-neutral max-w-none focus:outline-none min-h-[360px] text-sm sm:text-base leading-relaxed text-[var(--text-primary)]",
        },
      },
    },
    [ydoc, awareness, isEditable, currentUser?.name, userColor.hex]
  );

  // Clean up per-page Awareness and Y.Doc instances after provider teardown on page switch or unmount
  useEffect(() => {
    return () => {
      try {
        awareness.destroy();
      } catch {
        // Ignore double-destroy on Fast Refresh
      }
      try {
        ydoc.destroy();
      } catch {
        // Ignore double-destroy on Fast Refresh
      }
    };
  }, [awareness, ydoc]);

  if (!isMounted) {
    return (
      <div className="flex justify-center w-full">
        <div className="w-full max-w-[780px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl shadow-xs px-6 sm:px-12 py-10 space-y-6 animate-pulse">
          <div className="h-10 bg-[var(--bg-raised)] rounded-md w-3/4" />
          <div className="space-y-3 pt-4">
            <div className="h-4 bg-[var(--bg-raised)] rounded w-full" />
            <div className="h-4 bg-[var(--bg-raised)] rounded w-5/6" />
            <div className="h-4 bg-[var(--bg-raised)] rounded w-2/3" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="relative flex justify-center w-full">
      {/* Centered Manuscript Sheet */}
      <div className="w-full max-w-[780px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl shadow-xs px-6 sm:px-12 pt-8 pb-16 min-h-[calc(100vh-10rem)] transition-colors duration-150 relative space-y-4">
        {/* Parent Page Breadcrumb (if any) */}
        {parentPage && (
          <div className="text-xs text-[var(--text-faint)] flex items-center gap-1.5 pb-1">
            <span>Parent:</span>
            <a
              href={`/workspace/${workspaceId}?page=${parentPage.id}`}
              className="text-[var(--accent)] hover:underline font-medium"
            >
              {parentPage.title}
            </a>
          </div>
        )}

        {/* Document Title & Unified Sub-Header */}
        <div className="space-y-3">
          <DocumentTitle
            key={pageId}
            workspaceId={workspaceId}
            pageId={pageId}
            initialTitle={initialTitle}
            isEditable={isEditable}
            onTitleUpdated={() => {
              router.refresh();
            }}
          />

          {/* Sub-Header: Author & Timestamp on Left; Unified Health & Controls on Right */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1 pb-3 border-b border-[var(--border-subtle)]">
            {/* Metadata (Author, Date, Role) */}
            <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-faint)] font-sans">
              <span>By {authorName || "Member"}</span>
              <span>•</span>
              <span>{formattedDate}</span>
              <span className="px-1.5 py-0.2 rounded text-[10px] font-mono uppercase tracking-wider bg-[var(--bg-raised)] text-[var(--text-muted)] border border-[var(--border-subtle)]">
                {currentUser?.role || "VIEWER"}
              </span>
            </div>

            {/* Unified Controls & Document Health Cluster */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Active Collaborators Presence */}
              <CollaboratorAvatars
                awareness={awareness}
                currentUserId={currentUser?.id}
                currentUserRole={currentUser?.role}
              />

              {/* Unified Document Health Pill (Steady Live Dot + Saved Indicator) */}
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-raised)] text-[11px] font-medium text-[var(--text-muted)] select-none">
                <CollabStatusBadge
                  status={collabStatus}
                  errorMessage={collabError}
                  onRetry={() => {
                    if (providerRef.current) providerRef.current.connect();
                  }}
                />
                <span className="text-[var(--border-strong)]" aria-hidden="true">
                  ·
                </span>
                <SaveStatusBadge
                  status={currentDocStatus}
                  errorMessage={saveErrorMessage || collabError || undefined}
                  onRetry={handleRetrySave}
                />
              </div>

              {/* Comments Toggle Button */}
              <button
                type="button"
                onClick={() =>
                  setIsCommentsOpen((prev) => {
                    const next = !prev;
                    if (next) setIsHistoryOpen(false);
                    return next;
                  })
                }
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border transition-colors cursor-pointer",
                  isCommentsOpen
                    ? "bg-[var(--accent-light)] text-[var(--accent)] border-[var(--accent-border)] font-medium"
                    : "bg-[var(--bg-surface)] text-[var(--text-muted)] border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                )}
                title={isCommentsOpen ? "Close comments panel" : "Open comments panel"}
                aria-label={isCommentsOpen ? "Close comments panel" : "Open comments panel"}
              >
                <MessageSquare className="w-3.5 h-3.5 text-[var(--accent)]" />
                <span>Comments</span>
                {commentsCount > 0 && (
                  <span className="ml-0.5 px-1.5 py-0.2 rounded text-[10px] font-mono bg-[var(--bg-raised)] text-[var(--text-muted)]">
                    {commentsCount}
                  </span>
                )}
              </button>

              {/* Version History Toggle Button */}
              <button
                type="button"
                onClick={() =>
                  setIsHistoryOpen((prev) => {
                    const next = !prev;
                    if (next) setIsCommentsOpen(false);
                    return next;
                  })
                }
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border transition-colors cursor-pointer",
                  isHistoryOpen
                    ? "bg-[var(--accent-light)] text-[var(--accent)] border-[var(--accent-border)] font-medium"
                    : "bg-[var(--bg-surface)] text-[var(--text-muted)] border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                )}
                title={isHistoryOpen ? "Close version history" : "Open version history"}
                aria-label={isHistoryOpen ? "Close version history" : "Open version history"}
              >
                <Clock className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                <span>History</span>
              </button>
            </div>
          </div>
        </div>

        {/* Compact Formatting Toolbar (or Read-Only Indicator) */}
        {isEditable ? (
          <div className="pt-1 pb-1">
            <EditorToolbar editor={editor} disabled={false} />
          </div>
        ) : (
          <div className="my-2 px-3 py-1.5 rounded-md bg-[var(--bg-raised)] border border-[var(--border-subtle)] flex items-center justify-between text-xs text-[var(--text-muted)]">
            <div className="flex items-center gap-2 font-medium">
              <Eye className="w-4 h-4 text-[var(--text-faint)] shrink-0" />
              <span>
                {currentUser?.role === "COMMENTER"
                  ? "Commenter Mode — You can view and comment, but document editing is disabled."
                  : "View-Only Mode — You have read-only access to this document."}
              </span>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded bg-[var(--bg-hover)] border border-[var(--border-subtle)] font-mono font-medium text-[var(--text-muted)] uppercase tracking-wider shrink-0">
              {currentUser?.role || "VIEWER"}
            </span>
          </div>
        )}

        {/* Version Preview Alert Banner */}
        {previewVersion && (
          <div className="p-3 my-2 rounded-md bg-[var(--bg-raised)] border border-[var(--border-subtle)] text-xs flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-[var(--text-primary)]">
                Historical Version:
              </span>
              <span className="text-[var(--text-muted)] font-mono text-[11px]">
                {previewVersion.label || "Snapshot"} (
                {new Date(previewVersion.createdAt).toLocaleDateString()} at{" "}
                {new Date(previewVersion.createdAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                )
              </span>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider bg-[var(--accent-light)] text-[var(--accent)] border border-[var(--accent-border)]/40">
                Read-Only Preview
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPreviewVersion(null)}
                className="px-2.5 py-1 rounded-md bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] text-xs font-medium transition-colors cursor-pointer"
              >
                Exit Preview
              </button>
              {(currentUser?.role === "OWNER" || currentUser?.role === "EDITOR") && (
                <button
                  type="button"
                  onClick={() => setRestoreTargetSnapshot(previewVersion)}
                  className="px-2.5 py-1 rounded-md bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] text-xs font-medium flex items-center gap-1 shadow-2xs transition-colors cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Restore Version</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* TipTap Editor Surface or Read-Only Preview */}
        {previewVersion ? (
          <ReadOnlyPreview content={previewVersion.content} />
        ) : (
          <div className="min-h-[460px] focus-within:ring-0 editor-surface">
            <EditorContent editor={editor} />
          </div>
        )}
      </div>

        {/* Side Drawer for Comments */}
        {isCommentsOpen && (
          <aside className="fixed lg:sticky top-0 lg:top-12 right-0 h-screen lg:h-[calc(100vh-4rem)] z-30 shadow-lg lg:shadow-none bg-[var(--bg-surface)] border-l border-[var(--border-subtle)]">
            <CommentPanel
              key={pageId}
              workspaceId={workspaceId}
              pageId={pageId}
              isOpen={isCommentsOpen}
              onClose={() => setIsCommentsOpen(false)}
              currentUserId={currentUser?.id}
              currentUserRole={currentUser?.role}
              onCommentsCountChange={(count) => setCommentsCount(count)}
            />
          </aside>
        )}

        {/* Side Drawer for Version History */}
        {isHistoryOpen && (
          <aside className="fixed lg:sticky top-0 lg:top-12 right-0 h-screen lg:h-[calc(100vh-4rem)] z-30 shadow-lg lg:shadow-none bg-[var(--bg-surface)] border-l border-[var(--border-subtle)]">
            <VersionHistoryPanel
              key={`history-${pageId}`}
              workspaceId={workspaceId}
              pageId={pageId}
              isOpen={isHistoryOpen}
              onClose={() => {
                setIsHistoryOpen(false);
                setPreviewVersion(null);
              }}
              currentUserRole={currentUser?.role}
              selectedVersionId={previewVersion?.id || null}
              onSelectVersion={handleSelectVersionForPreview}
              onRequestRestore={(snapshot) => setRestoreTargetSnapshot(snapshot)}
              refreshTrigger={historyRefreshKey}
            />
          </aside>
        )}
      </div>

      {/* Restore Confirmation Dialog */}
      <RestoreConfirmationDialog
        isOpen={Boolean(restoreTargetSnapshot)}
        snapshot={restoreTargetSnapshot}
        isRestoring={isRestoring}
        error={restoreError}
        onConfirm={handleConfirmRestore}
        onCancel={() => {
          if (!isRestoring) {
            setRestoreTargetSnapshot(null);
            setRestoreError(null);
          }
        }}
      />

      {/* Scoped ProseMirror & Cursor Overrides */}
      <style jsx global>{`
        .editor-surface .ProseMirror {
          outline: none !important;
          min-height: 380px;
        }

        .editor-surface .ProseMirror h1,
        .editor-surface .ProseMirror h2,
        .editor-surface .ProseMirror h3 {
          font-family: var(--font-serif);
        }

        .editor-surface .ProseMirror p {
          color: var(--text-primary);
        }

        .editor-surface .ProseMirror blockquote {
          border-left: 2px solid var(--accent);
          color: var(--text-muted);
        }

        .editor-surface .ProseMirror pre {
          background-color: var(--bg-raised);
          border: 1px solid var(--border-subtle);
          color: var(--text-primary);
        }

        .editor-surface .ProseMirror code {
          background-color: var(--bg-raised);
          color: var(--accent);
          border: 1px solid var(--border-subtle);
        }

        .editor-surface .ProseMirror hr {
          border-top: 1px solid var(--border-subtle);
        }

        .editor-surface .ProseMirror p.is-editor-empty:first-child::before {
          color: var(--text-faint);
        }
      `}</style>
    </div>
  );
}
