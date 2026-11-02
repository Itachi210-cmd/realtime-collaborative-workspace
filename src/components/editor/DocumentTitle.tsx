"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";
import { SaveStatusBadge, SaveStatus } from "./SaveStatusBadge";

interface DocumentTitleProps {
  workspaceId: string;
  pageId: string;
  initialTitle: string;
  isEditable?: boolean;
  onTitleUpdated?: (newTitle: string) => void;
  onStatusChange?: (status: SaveStatus) => void;
}

export function DocumentTitle({
  workspaceId,
  pageId,
  initialTitle,
  isEditable = true,
  onTitleUpdated,
  onStatusChange,
}: DocumentTitleProps) {
  const [title, setTitle] = useState(initialTitle || "Untitled");
  const [status, setStatus] = useState<SaveStatus>("saved");

  const lastSavedTitleRef = useRef(initialTitle || "Untitled");
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const updateStatus = useCallback(
    (newStatus: SaveStatus) => {
      setStatus(newStatus);
      if (onStatusChange) {
        onStatusChange(newStatus);
      }
    },
    [onStatusChange]
  );

  const saveTitle = useCallback(
    async (titleToSave: string) => {
      const trimmed = titleToSave.trim() || "Untitled";
      if (trimmed === lastSavedTitleRef.current) {
        updateStatus("saved");
        return;
      }

      updateStatus("saving");

      try {
        const response = await fetch(
          `/api/workspaces/${workspaceId}/pages/${pageId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: trimmed }),
          }
        );

        if (!response.ok) {
          throw new Error("Failed to save title");
        }

        await response.json();
        lastSavedTitleRef.current = trimmed;
        updateStatus("saved");

        if (onTitleUpdated) {
          onTitleUpdated(trimmed);
        }
      } catch (error) {
        console.error("[TITLE_SAVE_ERROR]", error);
        updateStatus("error");
      }
    },
    [workspaceId, pageId, onTitleUpdated, updateStatus]
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setTitle(val);
    updateStatus("unsaved");

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      saveTitle(val);
    }, 800);
  };

  const handleBlur = () => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    saveTitle(title);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      inputRef.current?.blur();
    }
  };

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  return (
    <div className="group relative flex flex-col gap-1 w-full">
      <div className="flex items-center justify-between gap-4">
        <input
          ref={inputRef}
          type="text"
          value={title}
          disabled={!isEditable}
          onChange={handleChange}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          placeholder="Untitled"
          className="text-3xl font-bold tracking-tight text-[#37352f] w-full bg-transparent border-none outline-none focus:ring-0 placeholder:text-neutral-300 transition-colors py-1 px-0 disabled:opacity-80"
          aria-label="Document Title"
        />
        <div className="shrink-0 flex items-center">
          <SaveStatusBadge
            status={status}
            onRetry={() => saveTitle(title)}
          />
        </div>
      </div>
    </div>
  );
}
