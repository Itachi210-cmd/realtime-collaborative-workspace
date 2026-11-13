import { NextRequest, NextResponse } from "next/server";
import { normalizeOrigin } from "@/lib/env.mjs";

export const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
} as const;

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

/**
 * Single-instance in-memory sliding/fixed-window rate limiter.
 * Intended specifically for single-container deployment (e.g. Render Free Web Service
 * or single-node Docker Compose); NOT shared across multiple horizontal replicas.
 */
const MAX_RATE_LIMIT_BUCKETS = 5000;
const rateLimitStore = new Map<string, RateLimitBucket>();

function pruneRateLimitStore(now: number) {
  if (rateLimitStore.size < MAX_RATE_LIMIT_BUCKETS) return;
  for (const [key, bucket] of rateLimitStore.entries()) {
    if (bucket.resetAt <= now) {
      rateLimitStore.delete(key);
    }
  }
  while (rateLimitStore.size >= MAX_RATE_LIMIT_BUCKETS) {
    const oldestKey = rateLimitStore.keys().next().value;
    if (!oldestKey) break;
    rateLimitStore.delete(oldestKey);
  }
}

export function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  return "127.0.0.1";
}

export function enforceRateLimit(
  request: NextRequest,
  options: {
    keyPrefix: string;
    limit: number;
    windowMs: number;
    identifier?: string;
  }
): NextResponse | null {
  const now = Date.now();
  pruneRateLimitStore(now);

  const subject = options.identifier || getClientIp(request);
  const bucketKey = `${options.keyPrefix}:${subject}`;
  const existing = rateLimitStore.get(bucketKey);

  if (!existing || existing.resetAt <= now) {
    rateLimitStore.set(bucketKey, {
      count: 1,
      resetAt: now + options.windowMs,
    });
    return null;
  }

  existing.count += 1;
  if (existing.count > options.limit) {
    const retryAfterSec = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
    return NextResponse.json(
      {
        error: "Too many requests. Please wait a moment and try again.",
        retryAfterSeconds: retryAfterSec,
      },
      {
        status: 429,
        headers: {
          ...NO_STORE_HEADERS,
          "Retry-After": String(retryAfterSec),
          "X-RateLimit-Limit": String(options.limit),
          "X-RateLimit-Remaining": "0",
        },
      }
    );
  }

  return null;
}

/**
 * Defense-in-depth CSRF check for state-changing HTTP routes.
 * Blocks cross-site browser requests while allowing same-origin browsers and
 * direct non-browser API clients without Origin/Sec-Fetch-Site headers.
 */
export function verifySameOriginCsrf(request: NextRequest): NextResponse | null {
  const secFetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
  if (secFetchSite === "cross-site") {
    return NextResponse.json(
      { error: "Cross-site state-changing requests are forbidden." },
      { status: 403, headers: NO_STORE_HEADERS }
    );
  }

  const originHeader = request.headers.get("origin");
  if (!originHeader) {
    return null;
  }

  const requestOrigin = normalizeOrigin(originHeader);
  const allowedOrigins = new Set<string>();
  allowedOrigins.add(normalizeOrigin(request.nextUrl.origin));

  if (process.env.NEXT_PUBLIC_APP_URL) {
    allowedOrigins.add(normalizeOrigin(process.env.NEXT_PUBLIC_APP_URL));
  }

  const forwardedHost =
    request.headers.get("x-forwarded-host") || request.headers.get("host");
  const forwardedProto = request.headers.get("x-forwarded-proto") || "http";
  if (forwardedHost) {
    allowedOrigins.add(normalizeOrigin(`${forwardedProto}://${forwardedHost}`));
    allowedOrigins.add(normalizeOrigin(`https://${forwardedHost}`));
    allowedOrigins.add(normalizeOrigin(`http://${forwardedHost}`));
  }

  if (!allowedOrigins.has(requestOrigin)) {
    return NextResponse.json(
      { error: "Forbidden origin." },
      { status: 403, headers: NO_STORE_HEADERS }
    );
  }

  return null;
}

/**
 * Safely parses JSON request body with bounded byte length, distinguishing
 * oversized payloads (413) and invalid JSON (400) from internal errors (500).
 */
export async function readJsonBody<T = unknown>(
  request: NextRequest,
  maxBytes = 256 * 1024
): Promise<
  | { ok: true; data: T }
  | { ok: false; response: NextResponse }
> {
  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const declared = Number.parseInt(contentLength, 10);
    if (Number.isFinite(declared) && declared > maxBytes) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Request payload exceeds maximum allowed size." },
          { status: 413, headers: NO_STORE_HEADERS }
        ),
      };
    }
  }

  let rawText: string;
  try {
    rawText = await request.text();
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Unable to read request body." },
        { status: 400, headers: NO_STORE_HEADERS }
      ),
    };
  }

  if (Buffer.byteLength(rawText, "utf8") > maxBytes) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Request payload exceeds maximum allowed size." },
        { status: 413, headers: NO_STORE_HEADERS }
      ),
    };
  }

  if (!rawText.trim()) {
    return {
      ok: true,
      data: {} as T,
    };
  }

  try {
    return { ok: true, data: JSON.parse(rawText) as T };
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Invalid JSON in request body." },
        { status: 400, headers: NO_STORE_HEADERS }
      ),
    };
  }
}

export { sanitizeCallbackUrl } from "./url";

