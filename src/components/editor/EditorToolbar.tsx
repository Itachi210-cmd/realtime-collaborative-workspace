"use client";

import React, { useState, useEffect } from "react";
import { type Editor } from "@tiptap/react";
import {
  Heading1,
  Heading2,
  Heading3,
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  List,
  ListOrdered,
  Quote,
  Code,
  Minus,
  Link2,
  Unlink,
  Undo2,
  Redo2,
} from "lucide-react";

interface EditorToolbarProps {
  editor: Editor | null;
  disabled?: boolean;
}

export function EditorToolbar({ editor, disabled = false }: EditorToolbarProps) {
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [, setHistoryRevision] = useState(0);

  // Subscribe to editor transactions to reactively update toolbar states (canUndo, canRedo, active marks)
  useEffect(() => {
    if (!editor) return;

    const handleTransaction = () => {
      setHistoryRevision((r) => r + 1);
    };

    editor.on("transaction", handleTransaction);
    return () => {
      editor.off("transaction", handleTransaction);
    };
  }, [editor]);

  if (!editor) {
    return (
      <div className="sticky top-2 z-20 w-fit mx-auto px-3 py-1 bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-xs rounded-lg flex items-center justify-between gap-2 select-none transition-colors duration-150">
        <div className="flex items-center gap-0.5 overflow-x-auto py-0.5 opacity-60">
          <span className="text-xs text-[var(--text-faint)]">Loading editor tools...</span>
        </div>
      </div>
    );
  }

  const handleLinkSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!linkUrl.trim()) {
      editor.chain().focus().unsetLink().run();
    } else {
      let finalUrl = linkUrl.trim();
      if (!/^https?:\/\//i.test(finalUrl) && !finalUrl.startsWith("/")) {
        finalUrl = `https://${finalUrl}`;
      }
      editor
        .chain()
        .focus()
        .extendMarkRange("link")
        .setLink({ href: finalUrl, target: "_blank" })
        .run();
    }
    setShowLinkInput(false);
    setLinkUrl("");
  };

  const openLinkDialog = () => {
    if (editor.isActive("link")) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    const previousUrl = editor.getAttributes("link").href || "";
    setLinkUrl(previousUrl);
    setShowLinkInput(true);
  };

  const getButtonClass = (isActive: boolean, canExecute: boolean = true) => {
    const base =
      "p-1.5 rounded text-xs flex items-center justify-center focus:outline-none transition-colors";
    if (disabled || !canExecute) {
      return `${base} text-[var(--text-faint)] cursor-not-allowed opacity-40`;
    }
    if (isActive) {
      return `${base} bg-[var(--accent-light)] text-[var(--accent)] border border-[var(--accent-border)]/40 font-medium`;
    }
    return `${base} text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer`;
  };

  // Safe checks for undo/redo availability (evaluates Yjs Collaboration UndoManager via TipTap commands)
  const canUndo = Boolean(
    !disabled &&
    typeof editor.can === "function" &&
    (() => {
      try {
        return Boolean(editor.can().undo());
      } catch {
        return false;
      }
    })()
  );

  const canRedo = Boolean(
    !disabled &&
    typeof editor.can === "function" &&
    (() => {
      try {
        return Boolean(editor.can().redo());
      } catch {
        return false;
      }
    })()
  );

  const handleUndo = () => {
    if (!canUndo) return;
    try {
      // Direct collaborative command (does not disrupt ProseMirror transaction with chain focus)
      editor.commands.undo();
    } catch (err) {
      console.warn("[EditorToolbar] Collaborative Undo failed:", err);
    }
  };

  const handleRedo = () => {
    if (!canRedo) return;
    try {
      // Direct collaborative command (does not disrupt ProseMirror transaction with chain focus)
      editor.commands.redo();
    } catch (err) {
      console.warn("[EditorToolbar] Collaborative Redo failed:", err);
    }
  };

  return (
    <div className="sticky top-2 z-20 w-fit mx-auto px-2 py-1 bg-[var(--bg-surface)]/95 backdrop-blur-md border border-[var(--border-subtle)] shadow-xs rounded-lg flex flex-wrap items-center justify-between gap-1 select-none transition-colors duration-150">
      <div className="flex items-center gap-0.5 overflow-x-auto py-0.5 scrollbar-thin">
        {/* Section 1: Headings */}
        <button
          type="button"
          title="Heading 1 (Ctrl+Alt+1)"
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          className={getButtonClass(editor.isActive("heading", { level: 1 }))}
        >
          <Heading1 className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          title="Heading 2 (Ctrl+Alt+2)"
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          className={getButtonClass(editor.isActive("heading", { level: 2 }))}
        >
          <Heading2 className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          title="Heading 3 (Ctrl+Alt+3)"
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          className={getButtonClass(editor.isActive("heading", { level: 3 }))}
        >
          <Heading3 className="w-3.5 h-3.5" />
        </button>

        <span className="w-px h-3.5 bg-[var(--border-subtle)] mx-1 shrink-0" aria-hidden="true" />

        {/* Section 2: Inline Formatting */}
        <button
          type="button"
          title="Bold (Ctrl+B)"
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={getButtonClass(editor.isActive("bold"))}
        >
          <Bold className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          title="Italic (Ctrl+I)"
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={getButtonClass(editor.isActive("italic"))}
        >
          <Italic className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          title="Underline (Ctrl+U)"
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          className={getButtonClass(editor.isActive("underline"))}
        >
          <UnderlineIcon className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          title="Strikethrough (Ctrl+Shift+X)"
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleStrike().run()}
          className={getButtonClass(editor.isActive("strike"))}
        >
          <Strikethrough className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          title={editor.isActive("link") ? "Remove link" : "Add link (Ctrl+K)"}
          disabled={disabled}
          onClick={openLinkDialog}
          className={getButtonClass(editor.isActive("link"))}
        >
          {editor.isActive("link") ? (
            <Unlink className="w-3.5 h-3.5 text-[var(--accent)]" />
          ) : (
            <Link2 className="w-3.5 h-3.5" />
          )}
        </button>

        <span className="w-px h-3.5 bg-[var(--border-subtle)] mx-1 shrink-0" aria-hidden="true" />

        {/* Section 3: Lists & Blocks */}
        <button
          type="button"
          title="Bullet list (Ctrl+Shift+8)"
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={getButtonClass(editor.isActive("bulletList"))}
        >
          <List className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          title="Numbered list (Ctrl+Shift+7)"
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          className={getButtonClass(editor.isActive("orderedList"))}
        >
          <ListOrdered className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          title="Quote (Ctrl+Shift+B)"
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          className={getButtonClass(editor.isActive("blockquote"))}
        >
          <Quote className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          title="Code block"
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          className={getButtonClass(editor.isActive("codeBlock"))}
        >
          <Code className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          title="Horizontal divider"
          disabled={disabled}
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          className={getButtonClass(false)}
        >
          <Minus className="w-3.5 h-3.5" />
        </button>

        <span className="w-px h-3.5 bg-[var(--border-subtle)] mx-1 shrink-0" aria-hidden="true" />

        {/* Section 4: History */}
        <button
          type="button"
          title="Undo (Ctrl+Z)"
          disabled={!canUndo}
          onClick={handleUndo}
          className={getButtonClass(false, canUndo)}
        >
          <Undo2 className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          title="Redo (Ctrl+Y)"
          disabled={!canRedo}
          onClick={handleRedo}
          className={getButtonClass(false, canRedo)}
        >
          <Redo2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Inline Link Prompt Dialog */}
      {showLinkInput && (
        <form
          onSubmit={handleLinkSubmit}
          className="absolute left-1/2 -translate-x-1/2 top-11 z-30 flex items-center gap-1.5 p-1.5 bg-[var(--bg-surface)] rounded-md shadow-md border border-[var(--border-strong)] text-xs"
        >
          <input
            type="text"
            placeholder="Paste or enter URL..."
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            autoFocus
            className="px-2 py-1 bg-[var(--bg-app)] border border-[var(--border-subtle)] rounded text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] w-64"
          />
          <button
            type="submit"
            className="px-2.5 py-1 bg-[var(--accent)] text-white rounded text-xs font-medium hover:bg-[var(--accent-hover)] transition-colors"
          >
            Apply
          </button>
          <button
            type="button"
            onClick={() => setShowLinkInput(false)}
            className="px-2 py-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] text-xs"
          >
            Cancel
          </button>
        </form>
      )}
    </div>
  );
}

