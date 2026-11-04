/**
 * Deterministic Collaborator Color Assignment and Initials Utilities
 * Real-Time Collaborative Workspace - Phase 7
 */

export interface CollabColor {
  name: string;
  hex: string;
  lightBg: string;
  borderHex: string;
}

export const COLLAB_PALETTE: readonly CollabColor[] = [
  { name: "Coral", hex: "#E03E3E", lightBg: "#FBE4E4", borderHex: "#E03E3E" },
  { name: "Orange", hex: "#D9730D", lightBg: "#FAEBDD", borderHex: "#D9730D" },
  { name: "Amber", hex: "#CB9301", lightBg: "#FBF3DB", borderHex: "#CB9301" },
  { name: "Emerald", hex: "#0F7B6C", lightBg: "#DDEDEA", borderHex: "#0F7B6C" },
  { name: "Blue", hex: "#0B6E99", lightBg: "#DDEBF1", borderHex: "#0B6E99" },
  { name: "Indigo", hex: "#4C6EF5", lightBg: "#E8EDFB", borderHex: "#4C6EF5" },
  { name: "Purple", hex: "#6940A5", lightBg: "#EAE4F2", borderHex: "#6940A5" },
  { name: "Pink", hex: "#AD1A72", lightBg: "#F4DFEB", borderHex: "#AD1A72" },
] as const;

/**
 * Computes a fast, deterministic DJB2 hash of any string.
 */
function djb2Hash(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

/**
 * Deterministically maps a user ID (or fallback string) to a distinct color.
 */
export function getCollaboratorColor(userId?: string | null): CollabColor {
  if (!userId || typeof userId !== "string") {
    return COLLAB_PALETTE[0];
  }
  const index = djb2Hash(userId) % COLLAB_PALETTE.length;
  return COLLAB_PALETTE[index];
}

/**
 * Extracts 1-2 character uppercase initials from a user's display name or email.
 */
export function getInitials(name?: string | null, email?: string | null): string {
  const cleanName = (name || "").trim();
  if (cleanName) {
    const parts = cleanName.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return cleanName.slice(0, 2).toUpperCase();
  }

  const cleanEmail = (email || "").trim();
  if (cleanEmail) {
    const localPart = cleanEmail.split("@")[0] || "";
    return localPart.slice(0, 2).toUpperCase();
  }

  return "??";
}

