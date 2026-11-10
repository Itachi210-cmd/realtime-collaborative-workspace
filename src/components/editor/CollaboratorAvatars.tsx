"use client";

import React, { useEffect, useState, useMemo } from "react";
import { getInitials, getCollaboratorColor } from "@/lib/collab/collab-colors";

export interface CollaboratorUser {
  id: string;
  name: string;
  email?: string;
  color?: string;
  role?: string;
}

interface AwarenessState {
  user?: CollaboratorUser;
}

interface CollaboratorAvatarsProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  awareness: any | null | undefined;
  currentUserId?: string | null;
  currentUserRole?: string | null;
}

interface ActiveCollaborator {
  clientId: number;
  id: string;
  name: string;
  email?: string;
  color: string;
  role?: string;
  isSelf: boolean;
}

export function CollaboratorAvatars({
  awareness,
  currentUserId,
  currentUserRole,
}: CollaboratorAvatarsProps) {
  const [revision, setRevision] = useState(0);

  // Subscribe to Yjs Awareness protocol change events
  useEffect(() => {
    if (!awareness) return;

    const handleAwarenessChange = () => {
      setRevision((prev) => prev + 1);
    };

    awareness.on("change", handleAwarenessChange);
    awareness.on("update", handleAwarenessChange);

    return () => {
      try {
        awareness.off("change", handleAwarenessChange);
        awareness.off("update", handleAwarenessChange);
      } catch {
        // Safe disposal
      }
    };
  }, [awareness]);

  // Extract and process active collaborators from awareness states
  const collaborators = useMemo<ActiveCollaborator[]>(() => {
    // Read revision to ensure recalculation on awareness update
    void revision;

    if (!awareness || typeof awareness.getStates !== "function") {
      return [];
    }

    try {
      const states = awareness.getStates() as Map<number, AwarenessState>;
      const localClientId = awareness.clientID as number | undefined;

      const list: ActiveCollaborator[] = [];
      const seenUserIds = new Set<string>();

      states.forEach((state, clientId) => {
        if (!state || !state.user) return;
        const u = state.user;
        const userId = u.id || `client-${clientId}`;

        // Deduplicate multiple tabs of same user while keeping self status accurate
        const isSelf = Boolean(
          clientId === localClientId || (currentUserId && u.id === currentUserId)
        );

        if (seenUserIds.has(userId) && !isSelf) {
          return;
        }
        seenUserIds.add(userId);

        const assignedColor = u.color || getCollaboratorColor(userId).hex;

        list.push({
          clientId,
          id: userId,
          name: u.name || "Anonymous",
          email: u.email,
          color: assignedColor,
          role: u.role || (isSelf ? currentUserRole || "Editor" : "Collaborator"),
          isSelf,
        });
      });

      // Sort: current user first, then alphabetically by name
      list.sort((a, b) => {
        if (a.isSelf) return -1;
        if (b.isSelf) return 1;
        return a.name.localeCompare(b.name);
      });

      return list;
    } catch (err) {
      console.warn("[CollaboratorAvatars] Failed to read awareness states:", err);
      return [];
    }
  }, [awareness, revision, currentUserId, currentUserRole]);

  if (collaborators.length === 0) {
    return null;
  }

  const MAX_VISIBLE_AVATARS = 4;
  const visibleCollaborators = collaborators.slice(0, MAX_VISIBLE_AVATARS);
  const overflowCount = Math.max(0, collaborators.length - MAX_VISIBLE_AVATARS);
  const overflowCollaborators = collaborators.slice(MAX_VISIBLE_AVATARS);

  return (
    <div
      className="flex items-center -space-x-1.5 overflow-visible select-none py-0.5"
      role="group"
      aria-label="Active collaborators"
    >
      {visibleCollaborators.map((c) => {
        const initials = getInitials(c.name, c.email);
        const titleText = `${c.name}${c.isSelf ? " (You)" : ""}${c.role ? ` • ${c.role}` : ""} — Active now`;

        return (
          <div
            key={`${c.id}-${c.clientId}`}
            className="group relative focus:outline-none"
            title={titleText}
          >
            {/* Avatar Circle with Coloured Ring */}
            <div
              tabIndex={0}
              className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-mono font-medium text-white transition-transform group-hover:scale-110 group-hover:z-30 ring-2 ring-[var(--bg-surface)] cursor-pointer"
              style={{
                backgroundColor: c.color,
              }}
              aria-label={titleText}
            >
              <span>{initials}</span>
            </div>

            {/* Hover Tooltip Card */}
            <div className="absolute right-0 bottom-full mb-1.5 hidden group-hover:flex flex-col items-center z-40 pointer-events-none">
              <div className="bg-[var(--bg-surface)] text-[var(--text-primary)] text-[11px] font-medium py-1 px-2.5 rounded border border-[var(--border-strong)] shadow-md whitespace-nowrap flex items-center gap-1.5">
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: c.color }}
                  aria-hidden="true"
                />
                <span className="font-semibold">{c.name}</span>
                {c.isSelf && (
                  <span className="text-[10px] text-[var(--text-faint)] font-normal">
                    (You)
                  </span>
                )}
                {c.role && (
                  <span className="text-[10px] text-[var(--text-muted)] capitalize">
                    • {c.role.toLowerCase()}
                  </span>
                )}
              </div>
              <div className="w-1.5 h-1.5 bg-[var(--bg-surface)] border-r border-b border-[var(--border-strong)] rotate-45 -mt-1" />
            </div>
          </div>
        );
      })}

      {/* Overflow Avatar Badge (+N) */}
      {overflowCount > 0 && (
        <div
          className="group relative"
          title={`${overflowCount} more collaborator${overflowCount > 1 ? "s" : ""}: ${overflowCollaborators.map((c) => c.name).join(", ")}`}
        >
          <div className="w-6 h-6 rounded-full bg-[var(--bg-raised)] text-[var(--text-muted)] border border-[var(--border-subtle)] text-[9px] font-mono font-medium flex items-center justify-center ring-2 ring-[var(--bg-surface)] cursor-pointer group-hover:bg-[var(--bg-hover)] group-hover:scale-110 group-hover:z-30 transition-transform">
            <span>+{overflowCount}</span>
          </div>

          {/* Overflow Hover Tooltip */}
          <div className="absolute right-0 bottom-full mb-1.5 hidden group-hover:flex flex-col items-center z-40 pointer-events-none">
            <div className="bg-[var(--bg-surface)] text-[var(--text-primary)] text-[11px] py-1.5 px-2.5 rounded border border-[var(--border-strong)] shadow-md whitespace-nowrap space-y-1 max-w-xs">
              <div className="font-semibold pb-1 border-b border-[var(--border-subtle)] text-[var(--text-muted)]">
                +{overflowCount} more collaborator{overflowCount > 1 ? "s" : ""}
              </div>
              {overflowCollaborators.map((oc) => (
                <div key={oc.id} className="flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ backgroundColor: oc.color }}
                  />
                  <span>{oc.name}</span>
                </div>
              ))}
            </div>
            <div className="w-1.5 h-1.5 bg-[var(--bg-surface)] border-r border-b border-[var(--border-strong)] rotate-45 -mt-1" />
          </div>
        </div>
      )}
    </div>
  );
}

