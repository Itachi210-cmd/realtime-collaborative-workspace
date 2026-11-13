/**
 * Client-safe URL sanitization utilities.
 * Completely free of Node.js and Next server-only dependencies.
 */

/**
 * Sanitizes a candidate callback/redirect URL to prevent open-redirect attacks.
 * Rejects non-relative paths, protocol-relative URLs (//), and backslash-prefixed paths (/\\).
 * Always defaults to `/dashboard` for falsy or invalid values.
 */
export function sanitizeCallbackUrl(rawUrl: string | null | undefined): string {
  if (!rawUrl || typeof rawUrl !== "string") return "/dashboard";
  const trimmed = rawUrl.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.startsWith("/\\")) {
    return "/dashboard";
  }
  return trimmed;
}
