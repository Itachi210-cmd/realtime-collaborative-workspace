"use client";

import React, { useState } from "react";
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

  if (!editor) {
    return (
      <div className="sticky top-0 z-10 -mx-4 -mt-4 px-4 py-2 bg-white/95 backdrop-blur-xs border-b border-[#e9e9e7] flex items-center justify-between gap-2 select-none">
        <div className="flex items-center gap-0.5 overflow-x-auto py-0.5 opacity-50">
          <span className="text-xs text-neutral-400">Loading editor tools...</span>
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
      "p-1.5 rounded transition-colors text-xs flex items-center justify-center focus:outline-none";
    if (disabled || !canExecute) {
      return `${base} text-neutral-300 cursor-not-allowed opacity-50`;
    }
    if (isActive) {
      return `${base} bg-[#e3e2e0] text-[#37352f] font-medium shadow-xs`;
    }
    return `${base} text-neutral-600 hover:bg-[#efefed] hover:text-[#37352f] cursor-pointer`;
  };

  return (
    <div className="sticky top-0 z-10 -mx-4 -mt-4 px-4 py-2 bg-white/95 backdrop-blur-xs border-b border-[#e9e9e7] flex flex-wrap items-center justify-between gap-2 select-none">
      <div className="flex items-center gap-0.5 overflow-x-auto py-0.5">
        {/* Headings */}
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

        <span className="w-px h-4 bg-neutral-200 mx-1" aria-hidden="true" />

        {/* Inline Marks */}
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

        <span className="w-px h-4 bg-neutral-200 mx-1" aria-hidden="true" />

        {/* Lists & Blocks */}
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

        <span className="w-px h-4 bg-neutral-200 mx-1" aria-hidden="true" />

        {/* Link */}
        <button
          type="button"
          title={editor.isActive("link") ? "Remove link" : "Add link (Ctrl+K)"}
          disabled={disabled}
          onClick={openLinkDialog}
          className={getButtonClass(editor.isActive("link"))}
        >
          {editor.isActive("link") ? (
            <Unlink className="w-3.5 h-3.5 text-blue-600" />
          ) : (
            <Link2 className="w-3.5 h-3.5" />
          )}
        </button>

        <span className="w-px h-4 bg-neutral-200 mx-1" aria-hidden="true" />

        {/* History */}
        <button
          type="button"
          title="Undo (Ctrl+Z)"
          disabled={disabled || !editor.can().undo()}
          onClick={() => editor.chain().focus().undo().run()}
          className={getButtonClass(false, editor.can().undo())}
        >
          <Undo2 className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          title="Redo (Ctrl+Y)"
          disabled={disabled || !editor.can().redo()}
          onClick={() => editor.chain().focus().redo().run()}
          className={getButtonClass(false, editor.can().redo())}
        >
          <Redo2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Inline Link Prompt Dialog */}
      {showLinkInput && (
        <form
          onSubmit={handleLinkSubmit}
          className="absolute left-4 top-11 z-20 flex items-center gap-1.5 p-1.5 bg-white rounded-md shadow-lg border border-neutral-200 text-xs"
        >
          <input
            type="text"
            placeholder="Paste or enter URL..."
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            autoFocus
            className="px-2 py-1 border border-neutral-200 rounded text-xs text-[#37352f] focus:outline-none focus:border-[#2383e2] w-64"
          />
          <button
            type="submit"
            className="px-2.5 py-1 bg-[#2383e2] text-white rounded text-xs font-medium hover:bg-blue-600 transition-colors"
          >
            Apply
          </button>
          <button
            type="button"
            onClick={() => setShowLinkInput(false)}
            className="px-2 py-1 text-neutral-500 hover:text-neutral-700 text-xs"
          >
            Cancel
          </button>
        </form>
      )}
    </div>
  );
}

