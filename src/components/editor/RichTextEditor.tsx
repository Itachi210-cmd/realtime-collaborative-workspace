"use client";

import React, { useState, useRef, useCallback, useEffect, useSyncExternalStore } from "react";
import { useEditor, EditorContent, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { EditorToolbar } from "./EditorToolbar";
import { DocumentTitle } from "./DocumentTitle";
import { SaveStatusBadge, SaveStatus } from "./SaveStatusBadge";
import { DEFAULT_PAGE_CONTENT } from "@/lib/validations/page";
import { useRouter } from "next/navigation";

interface RichTextEditorProps {
  workspaceId: string;
  pageId: string;
  initialTitle: string;
  initialContent?: JSONContent | null;
  isEditable?: boolean;
}

export function RichTextEditor({
  workspaceId,
  pageId,
  initialTitle,
  initialContent,
  isEditable = true,
}: RichTextEditorProps) {
  const router = useRouter();

  // React 19 idiomatic SSR / hydration safe client mounting
  const isMounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");

  // Parse initial content safely
  const resolvedInitialContent = React.useMemo(() => {
    if (
      initialContent &&
      typeof initialContent === "object" &&
      initialContent.type === "doc"
    ) {
      return initialContent;
    }
    return DEFAULT_PAGE_CONTENT;
  }, [initialContent]);

  const lastSavedJsonRef = useRef<string>(JSON.stringify(resolvedInitialContent));
  const pendingContentRef = useRef<JSONContent | null>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastRequestIdRef = useRef<number>(0);

  // Save content to backend
  const saveContent = useCallback(
    async (contentJson: JSONContent) => {
      const jsonStr = JSON.stringify(contentJson);
      if (jsonStr === lastSavedJsonRef.current) {
        setSaveStatus("saved");
        return;
      }

      const requestId = ++lastRequestIdRef.current;
      setSaveStatus("saving");

      try {
        const res = await fetch(
          `/api/workspaces/${workspaceId}/pages/${pageId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: contentJson }),
          }
        );

        if (!res.ok) {
          throw new Error(`Save failed with HTTP ${res.status}`);
        }

        // Avoid race conditions: only update saved ref if this was the latest request
        if (requestId === lastRequestIdRef.current) {
          lastSavedJsonRef.current = jsonStr;
          pendingContentRef.current = null;
          setSaveStatus("saved");
        }
      } catch (error) {
        console.error("[RICH_TEXT_SAVE_ERROR]", error);
        if (requestId === lastRequestIdRef.current) {
          setSaveStatus("error");
        }
      }
    },
    [workspaceId, pageId]
  );

  // Initialize TipTap
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
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
    ],
    content: resolvedInitialContent,
    editable: isEditable,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          "prose prose-neutral max-w-none focus:outline-none min-h-[360px] text-sm sm:text-base leading-relaxed text-[#37352f]",
      },
    },
    onUpdate: ({ editor: ed }) => {
      const json = ed.getJSON();
      pendingContentRef.current = json;
      setSaveStatus("unsaved");

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      debounceTimerRef.current = setTimeout(() => {
        saveContent(json);
      }, 1200);
    },
    onBlur: () => {
      if (pendingContentRef.current) {
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current);
        }
        saveContent(pendingContentRef.current);
      }
    },
  });

  // Flush any pending save on unmount / page switch
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      if (pendingContentRef.current) {
        const jsonStr = JSON.stringify(pendingContentRef.current);
        if (jsonStr !== lastSavedJsonRef.current) {
          // Use keepalive fetch to ensure request completes during unload/navigation
          fetch(`/api/workspaces/${workspaceId}/pages/${pageId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: pendingContentRef.current }),
            keepalive: true,
          }).catch(() => {
            // Ignore unload errors
          });
        }
      }
    };
  }, [workspaceId, pageId]);

  // Window beforeunload warning if unsaved
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (pendingContentRef.current && saveStatus === "unsaved") {
        e.preventDefault();
        e.returnValue = "";
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [saveStatus]);

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
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-neutral-400">Content state:</span>
              <SaveStatusBadge
                status={saveStatus}
                onRetry={() => {
                  if (editor) {
                    saveContent(editor.getJSON());
                  }
                }}
              />
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
