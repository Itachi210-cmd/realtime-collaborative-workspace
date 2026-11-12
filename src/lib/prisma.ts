import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { DEV_DEFAULT_DATABASE_URL, getDatabaseUrl } from "@/lib/env.mjs";

const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";
const connectionString = isBuildPhase
  ? process.env.DATABASE_URL || DEV_DEFAULT_DATABASE_URL
  : getDatabaseUrl();

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  pool: Pool | undefined;
};

function resolvePoolMax(): number {
  const parsed = Number.parseInt(process.env.PG_POOL_MAX || "", 10);
  if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 50) {
    return parsed;
  }
  return process.env.NODE_ENV === "production" ? 5 : 10;
}

function createPgPool(): Pool {
  const pgPool = new Pool({
    connectionString,
    max: resolvePoolMax(),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    allowExitOnIdle: true,
  });

  pgPool.on("error", (err) => {
    console.error("[PrismaPool] Unexpected idle PostgreSQL client error:", err.message);
  });

  return pgPool;
}

const pool = globalForPrisma.pool ?? createPgPool();
const adapter = new PrismaPg(pool);

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

globalForPrisma.prisma = prisma;
globalForPrisma.pool = pool;
