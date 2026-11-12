import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateRedisConfig } from "@/lib/env.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEALTH_TIMEOUT_MS = 2500;

interface CollabHealthPayload {
  status?: string;
  uptime?: number;
  roomsCount?: number;
  database?: {
    status?: string;
    healthy?: boolean;
  };
  redis?: {
    enabled?: boolean;
    status?: string;
    healthy?: boolean;
  };
}

function parseCollabPort(): number {
  const raw = process.env.COLLAB_PORT?.trim();
  if (!raw) return 1234;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return 1234;
  }
  return parsed;
}

export async function GET() {
  const startedAt = Date.now();

  let dbHealthy = false;
  let dbStatus = "unavailable";
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Database health check timeout")), HEALTH_TIMEOUT_MS)
      ),
    ]);
    dbHealthy = true;
    dbStatus = "ready";
  } catch {
    dbHealthy = false;
    dbStatus = "unavailable";
  }

  const redisEnabled = validateRedisConfig({
    enabledEnv: process.env.REDIS_ENABLED,
    urlEnv: process.env.REDIS_URL,
  }).enabled;
  const collabPort = parseCollabPort();
  let collabHealthy = false;
  let collabStatus = "unavailable";
  let collabPayload: CollabHealthPayload | null = null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    try {
      const response = await fetch(`http://127.0.0.1:${collabPort}/healthz`, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
      });
      const data = (await response.json()) as CollabHealthPayload;
      collabPayload = data;
      collabHealthy = response.ok && data?.status === "ok";
      collabStatus = data?.status || (response.ok ? "ok" : "degraded");
    } finally {
      clearTimeout(timer);
    }
  } catch {
    collabHealthy = false;
    collabStatus = "unavailable";
  }

  const redisHealthy = redisEnabled
    ? Boolean(collabPayload?.redis?.healthy)
    : true;
  const redisStatus = redisEnabled
    ? collabPayload?.redis?.status || "unavailable"
    : "disabled";

  const healthy = dbHealthy && collabHealthy && redisHealthy;

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      latencyMs: Date.now() - startedAt,
      checks: {
        app: {
          status: "ready",
          healthy: true,
        },
        database: {
          status: dbStatus,
          healthy: dbHealthy,
        },
        collab: {
          status: collabStatus,
          healthy: collabHealthy,
          roomsCount: collabPayload?.roomsCount ?? 0,
        },
        redis: {
          enabled: redisEnabled,
          status: redisStatus,
          healthy: redisHealthy,
        },
      },
    },
    {
      status: healthy ? 200 : 503,
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    }
  );
}
