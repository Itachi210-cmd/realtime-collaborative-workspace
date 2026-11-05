"use client";

import React, { useState, useRef, useMemo, useEffect, useCallback, useSyncExternalStore } from "react";
import { useEditor, EditorContent, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Collaboration from "@tiptap/extension-collaboration";
import { CollaborationCursor } from "@/lib/collab/collaboration-cursor";
import * as Y from "yjs";
import * as awarenessProtocol from "y-protocols/awareness";
import { EditorToolbar } from "./EditorToolbar";
import { DocumentTitle } from "./DocumentTitle";
import { CollabStatusBadge } from "./CollabStatusBadge";
import { CollaboratorAvatars } from "./CollaboratorAvatars";
import { SaveStatusBadge, type SaveStatus } from "./SaveStatusBadge";
import { getCollaboratorColor } from "@/lib/collab/collab-colors";
import {
  createCollabWebsocketProvider,
  type CollabConnectionStatus,
  type CollabWebsocketProvider,
  type SaveStatusDetails,
} from "@/lib/collab/collab-provider";
import { DEFAULT_PAGE_CONTENT } from "@/lib/validations/page";
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
}

export function RichTextEditor({
  workspaceId,
  pageId,
  initialTitle,
  initialContent,
  isEditable = true,
  currentUser,
}: RichTextEditorProps) {
  const router = useRouter();

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

  // Monotonic tracking of local user edits to prevent stale acknowledgements
  const localEditCountRef = useRef<number>(0);
  const lastAcknowledgedEditCountRef = useRef<number>(0);
  const [hasPendingLocalEdits, setHasPendingLocalEdits] = useState<boolean>(false);

  // Deterministically assign accessible color based on authenticated userId
  const userColor = useMemo(() => {
    return getCollaboratorColor(currentUser?.id);
  }, [currentUser?.id]);

  // Parse initial content safely (used only when collaboration is inactive)
  const resolvedInitialContent = useMemo(() => {
    if (
      initialContent &&
      typeof initialContent === "object" &&
      initialContent.type === "doc"
    ) {
      return initialContent;
    }
    return DEFAULT_PAGE_CONTENT;
  }, [initialContent]);

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

  // Manage WebSocket provider lifecycle in useEffect (resilient to React StrictMode and component remounts)
  useEffect(() => {
    if (!isMounted || !isEditable) return;

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
  }, [isMounted, isEditable, workspaceId, pageId, ydoc, awareness]);

  // Unified document persistence & sync status state machine
  const currentDocStatus: SaveStatus = useMemo(() => {
    if (!isEditable) return "saved";

    // 1. Connection-level states take precedence
    if (collabStatus === "connecting") return "connecting";
    if (collabStatus === "reconnecting") return "reconnecting";
    if (collabStatus === "disconnected") return "offline";
    if (collabStatus === "auth_error") return "error";

    // 2. Initial Yjs sync pending
    if (!isSynced) return "syncing";

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
                "text-[#2383e2] underline underline-offset-2 hover:text-blue-700 cursor-pointer",
            },
          },
          underline: {},
        }),
        Placeholder.configure({
          placeholder: "Press '/' for commands, or start typing...",
          emptyEditorClass: "is-editor-empty",
        }),
        ...(isEditable
          ? [
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
          ]
          : []),
      ],
      // When collaboration is active, Y.Doc is the source of truth
      content: isEditable ? undefined : resolvedInitialContent,
      editable: isEditable,
      immediatelyRender: false,
      editorProps: {
        attributes: {
          class:
            "prose prose-neutral max-w-none focus:outline-none min-h-[360px] text-sm sm:text-base leading-relaxed text-[#37352f]",
        },
      },
      // HTTP content autosave is disabled while collaboration is active to prevent
      // overwriting concurrent collaborative edits with stale HTTP PATCH requests.
    },
    [ydoc, awareness, isEditable, resolvedInitialContent, currentUser?.name, userColor.hex]
  );

  if (!isMounted) {
    return (
      <div className="space-y-6">
        <div className="sticky top-0 z-10 -mx-4 -mt-4 px-4 py-2 bg-white/95 border-b border-[#e9e9e7] h-10 animate-pulse bg-neutral-50" />
        <div className="max-w-[768px] mx-auto px-4 py-8 space-y-6">
          <div className="h-10 bg-neutral-100 rounded-md w-3/4 animate-pulse" />
          <div className="space-y-3 pt-4">
            <div className="h-4 bg-neutral-100 rounded w-full animate-pulse" />
            <div className="h-4 bg-neutral-100 rounded w-5/6 animate-pulse" />
            <div className="h-4 bg-neutral-100 rounded w-2/3 animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Sticky Formatting Toolbar */}
      <EditorToolbar editor={editor} disabled={!isEditable} />

      {/* Centered Document Canvas (720px - 768px) */}
      <div className="max-w-[768px] mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Document Title Header */}
        <div className="space-y-3 pb-2 border-b border-neutral-100">
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

          <div className="flex items-center justify-between text-xs text-neutral-400">
            <span>Notion-inspired rich document editor</span>
            <div className="flex items-center gap-3">
              {/* Collaborator Presence Avatar Bar */}
              <CollaboratorAvatars
                awareness={isEditable ? awareness : null}
                currentUserId={currentUser?.id}
                currentUserRole={currentUser?.role}
              />

              {/* Document Persistence & Sync Status Badge */}
              <SaveStatusBadge
                status={currentDocStatus}
                errorMessage={saveErrorMessage || collabError || undefined}
                onRetry={handleRetrySave}
              />

              <div className="flex items-center gap-2 border-l border-neutral-200 pl-3">
                <span className="text-[11px] text-neutral-400">Collaboration:</span>
                <CollabStatusBadge
                  status={isEditable ? collabStatus : "disconnected"}
                  errorMessage={collabError}
                  onRetry={() => {
                    if (providerRef.current) {
                      providerRef.current.connect();
                    }
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* TipTap Editor Surface */}
        <div className="min-h-[420px] focus-within:ring-0 editor-surface">
          <EditorContent editor={editor} />
        </div>
      </div>

      {/* Notion Editor Styles Scoped to TipTap */}
      <style jsx global>{`
        .editor-surface .ProseMirror {
          outline: none !important;
          min-height: 380px;
        }

        /* Remote Collaboration Carets & Labels */
        .collaboration-cursor__caret {
          position: relative;
          margin-left: -1px;
          margin-right: -1px;
          border-left: 2px solid;
          border-right: 0px solid;
          word-break: normal;
          pointer-events: none;
        }

        .collaboration-cursor__label {
          position: absolute;
          top: -1.4em;
          left: -2px;
          font-size: 11px;
          font-weight: 600;
          line-height: 1;
          color: #ffffff;
          padding: 2px 6px;
          border-radius: 4px 4px 4px 0;
          white-space: nowrap;
          user-select: none;
          pointer-events: none;
          z-index: 20;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
          font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
          letter-spacing: 0.01em;
        }

        .ProseMirror-yjs-selection {
          opacity: 0.8;
          border-radius: 2px;
        }

        .editor-surface .ProseMirror h1 {
          font-size: 1.875rem;
          line-height: 2.25rem;
          font-weight: 700;
          color: #37352f;
          margin-top: 1.5rem;
          margin-bottom: 0.5rem;
          letter-spacing: -0.025em;
        }

        .editor-surface .ProseMirror h2 {
          font-size: 1.5rem;
          line-height: 2rem;
          font-weight: 600;
          color: #37352f;
          margin-top: 1.25rem;
          margin-bottom: 0.5rem;
          letter-spacing: -0.02em;
        }

        .editor-surface .ProseMirror h3 {
          font-size: 1.25rem;
          line-height: 1.75rem;
          font-weight: 600;
          color: #37352f;
          margin-top: 1rem;
          margin-bottom: 0.375rem;
        }

        .editor-surface .ProseMirror p {
          font-size: 0.95rem;
          line-height: 1.7;
          color: #37352f;
          margin-top: 0.35rem;
          margin-bottom: 0.35rem;
        }

        .editor-surface .ProseMirror ul {
          list-style-type: disc;
          padding-left: 1.5rem;
          margin-top: 0.5rem;
          margin-bottom: 0.5rem;
        }

        .editor-surface .ProseMirror ol {
          list-style-type: decimal;
          padding-left: 1.5rem;
          margin-top: 0.5rem;
          margin-bottom: 0.5rem;
        }

        .editor-surface .ProseMirror li {
          margin-top: 0.2rem;
          margin-bottom: 0.2rem;
          line-height: 1.6;
        }

        .editor-surface .ProseMirror blockquote {
          border-left: 3px solid #dfdfde;
          padding-left: 1rem;
          margin-top: 0.75rem;
          margin-bottom: 0.75rem;
          font-style: italic;
          color: #5a5751;
        }

        .editor-surface .ProseMirror pre {
          background-color: #f7f6f3;
          border: 1px solid #e9e9e7;
          border-radius: 0.375rem;
          padding: 0.75rem 1rem;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 0.8125rem;
          color: #37352f;
          overflow-x: auto;
          margin-top: 0.75rem;
          margin-bottom: 0.75rem;
        }

        .editor-surface .ProseMirror code {
          background-color: #f0f0ef;
          color: #eb5757;
          border-radius: 0.25rem;
          padding: 0.125rem 0.3rem;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 0.8125rem;
        }

        .editor-surface .ProseMirror hr {
          border: none;
          border-top: 1px solid #e9e9e7;
          margin-top: 1.5rem;
          margin-bottom: 1.5rem;
        }

        .editor-surface .ProseMirror p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          float: left;
          color: #9b9a97;
          pointer-events: none;
          height: 0;
        }
      `}</style>
    </div>
  );
}
