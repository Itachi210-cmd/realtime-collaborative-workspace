"use client";

import React, { useEffect } from "react";
import { useEditor, EditorContent, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

interface ReadOnlyPreviewProps {
  content: unknown;
}

export function ReadOnlyPreview({ content }: ReadOnlyPreviewProps) {
  const jsonContent = (content as JSONContent) || { type: "doc", content: [] };
  const editor = useEditor({
    editable: false,
    content: jsonContent,
    extensions: [
      StarterKit.configure({
        undoRedo: false,
        heading: { levels: [1, 2, 3] },
      }),
    ],
  });

  useEffect(() => {
    if (editor && content) {
      try {
        editor.commands.setContent(content as JSONContent);
      } catch (err) {
        console.warn("[ReadOnlyPreview] Failed to update editor content:", err);
      }
    }
  }, [editor, content]);

  if (!editor) return null;

  return (
    <div className="min-h-[420px] focus-within:ring-0 editor-surface read-only-preview opacity-95">
      <EditorContent editor={editor} />
    </div>
  );
}
