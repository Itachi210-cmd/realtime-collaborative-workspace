# Environment Variables & Secrets Reference

This document provides the authoritative reference for every environment variable read by **Real-Time Collaborative Workspace** across Next.js (`src/`), the dedicated Yjs collaboration server (`src/server/collab-server.mjs`), the production supervisor (`scripts/prod-entrypoint.mjs`), Docker Compose (`docker-compose.yml`, `docker-compose.prod.yml`), and Render Blueprint (`render.yaml`).

Startup validation is implemented centrally in `src/lib/env.mjs` and executed automatically during Next.js server startup (`src/instrumentation.ts`), collaboration server startup (`createCollabServer()`), and manual preflight (`npm run env:check` -> `scripts/validate_env.mjs`).

> **Never commit real secrets.** Keep `.env` and `.env.local` untracked (both are ignored by `.gitignore`) and commit only safe placeholders in `.env.example`.

---

## 1. Quick Generate Commands

Generate cryptographically strong production secrets locally (never store output inside tracked files):

```bash
# AUTH_SECRET (>= 32 bytes / base64url)
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

# INTERNAL_RPC_SECRET (strictly 64 lowercase hexadecimal chars = 32 random bytes)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 2. Core Application & Security Variables

| Variable | Purpose | Required / Optional | Scope | Development Default | Production Requirements & Validation (`src/lib/env.mjs`) |
| --- | --- | --- | --- | --- | --- |
| `NODE_ENV` | Controls strict validation, Next.js production mode, `Secure` session cookie flag, HSTS header, and runtime logging | Optional (auto-set by Next.js / Docker) | Server-only (`process.env`) | `development` (`npm run dev`) | Must be `production` in Docker/Render; triggers strict checks for `AUTH_SECRET`, `DATABASE_URL`, and `REDIS_URL`. |
| `DATABASE_URL` | PostgreSQL connection string for Prisma ORM (`@prisma/adapter-pg`), `collab-persistence.mjs`, and `prisma migrate deploy` | **Required** | Server-only | Set in local `.env` / `.env.local` (e.g. `postgresql://postgres:postgres@localhost:5432/collab_workspace?schema=public`) | Must start with `postgresql://` or `postgres://`, include a hostname, and in production reject weak/default passwords (`postgres`, `password`, `changeme`) and SSL modes `disable`/`allow`. Use `?sslmode=require` (or `verify-full`) for managed cloud PostgreSQL such as Neon. |
| `AUTH_SECRET` | HS256 signing/verification secret for both HTTP-only session JWT (`collab_session`) and short-lived WebSocket collaboration JWTs | **Required** | Server-only | Explicit non-empty value required (legacy 32+ char dev string logs a warning) | At least **32 characters** with **>= 12 distinct characters**; common placeholder substrings (`change-this`, `your-secret`, `example`, `placeholder`, `replace-me`, `default-secret`) are rejected. Production forbids the known legacy dev string. |
| `INTERNAL_RPC_SECRET` | Shared Bearer token authenticating Next.js -> `collab-server.mjs` loopback RPCs (`/internal/rooms/:pageId/flush`, `/internal/rooms/:pageId/restore`) | **Required** (for collab server startup & flush/restore RPCs) | Server-only | Explicitly set in `.env.local` | Strictly **64 hexadecimal characters** (`/^[0-9a-f]{64}$/i`) with **>= 8 distinct characters**. |
| `PG_POOL_MAX` | Maximum concurrent PostgreSQL connections per Node process (`pg.Pool` in `src/lib/prisma.ts` and `src/server/collab-persistence.mjs`) | Optional | Server-only | `5` when `NODE_ENV=production`, `10` otherwise (`validatePgPool` fallback if invalid) | Recommended `5` per process on constrained free tiers (Next.js + Collab Server share DB connection quotas). Must be integer `1..50` (out-of-range logs warning and falls back to `5`). |

---

## 3. Public & Client URLs

Only browser-safe values use the `NEXT_PUBLIC_` prefix. Because Next.js inlines `NEXT_PUBLIC_*` at build time (`npm run build`), `Dockerfile` accepts them as `--build-arg` arguments in `builder` stage; container runtime env also informs CSRF origin allowlists and server-side checks.

| Variable | Purpose | Required / Optional | Scope | Development Default | Production Requirements & Validation |
| --- | --- | --- | --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | Canonical public URL of the web application; used for CSRF origin allowlist (`verifySameOriginCsrf`), HSTS toggle in `next.config.ts`, and default WS allowed origins | Optional in dev; **Recommended / Required in prod** | Public (inlined into client bundle & read server-side) | `http://localhost:3000` (if unset during dev) | Valid `http://` or `https://` URL (no query params, hash, or embedded credentials). In production cloud deployments, set to your exact `https://<domain>` origin. |
| `NEXT_PUBLIC_COLLAB_WS_URL` | Public WebSocket endpoint for TipTap / Yjs `WebsocketProvider` (`getDefaultCollabWsUrl()`) | Optional (dynamic fallback exists) | Public (inlined into client bundle) | If unset, resolves dynamically: `ws://<hostname>:1234` on HTTP, or `wss://<host>/collab-ws` on HTTPS | Valid `ws://` or `wss://` URL (no query params/credentials). In single-port HTTPS deployments (e.g. Render Free), set `wss://<your-app>.onrender.com/collab-ws` (or leave unset on HTTPS to auto-use `wss://<host>/collab-ws`). In dual-port Docker Compose, set `ws://<host>:1234`. |

---

## 4. Collaboration WebSocket Server Variables

| Variable | Purpose | Required / Optional | Scope | Development Default | Production Requirements & Validation |
| --- | --- | --- | --- | --- | --- |
| `COLLAB_PORT` | TCP port listened on by `src/server/collab-server.mjs` and targeted by Next.js internal RPC client (`collab-internal-client.mjs`) | Optional | Server-only | `1234` | Valid port integer `1..65535`. In production container (`prod-entrypoint.mjs`), `COLLAB_PORT` stays internal (default `1234`, `COLLAB_HOST=127.0.0.1`). |
| `COLLAB_HOST` | Bind interface for `collab-server.mjs` | Optional | Server-only | `undefined` (Node dual-stack `0.0.0.0` / `::` for local LAN testing) | Set to `127.0.0.1` inside the single-container `Dockerfile` / production image so only `prod-entrypoint.mjs` proxies external traffic and `/internal/*` stays loopback-only. |
| `COLLAB_ALLOWED_ORIGINS` | Comma-separated allowlist of HTTP `Origin` headers permitted during WebSocket `upgrade` | Optional | Server-only | `http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001,http://127.0.0.1:3001` (+ `NEXT_PUBLIC_APP_URL` if set) | Comma-separated valid `http://` or `https://` origins (wildcard `*` is **rejected**). If omitted in prod, defaults plus `NEXT_PUBLIC_APP_URL` are used. Set explicitly if serving from additional hostnames. |
| `COLLAB_AUTH_TIMEOUT_MS` | Milliseconds a newly opened WebSocket has to send its first-message JWT auth frame before server termination (`4401`) | Optional | Server-only | `5000` (5 seconds) | Positive integer (validated via `validatePositiveIntEnv`). |
| `COLLAB_CLEANUP_GRACE_MS` | Grace period after the last WebSocket leaves a room before flushing, unsubscribing Redis, and destroying the in-memory `Y.Doc` | Optional | Server-only | `30000` (30 seconds) | Positive integer (validated via `validatePositiveIntEnv`). |

---

## 5. Redis Distributed Collaboration Variables

| Variable | Purpose | Required / Optional | Scope | Development Default | Production Requirements & Validation |
| --- | --- | --- | --- | --- | --- |
| `REDIS_ENABLED` | Toggles Redis Pub/Sub (`yjs_update`, `yjs_awareness`, `yjs_persisted`) and distributed persistence/restore locks in `collab-redis.mjs` | Optional | Server-only | `true` (any value other than `'false'` enables Redis) | Set `'true'` when running with Redis (Docker Compose prod / multi-instance). Set `'false'` for ₹0 single-instance cloud deployments without Redis (Render Free + Neon Free). |
| `REDIS_URL` | Redis connection URL passed to `ioredis` (`pubClient` + `subClient`) when `REDIS_ENABLED` is not `'false'` | **Required when `REDIS_ENABLED=true`**; ignored when `false` | Server-only | `redis://localhost:6379` (in `collab-server.mjs`) | Must use `redis://` or `rediss://`. Credentials are automatically redacted in logs via `redactConnectionUrl()`. When `REDIS_ENABLED=false`, Redis checks succeed without connecting. |

---

## 6. Production Supervisor & Proxy Variables (`scripts/prod-entrypoint.mjs`)

| Variable | Purpose | Required / Optional | Scope | Development Default | Production Requirements & Validation |
| --- | --- | --- | --- | --- | --- |
| `PORT` | Public HTTP + multiplexed WebSocket port exposed by `prod-entrypoint.mjs` | Optional | Server-only | `3000` (`Dockerfile` sets `PORT=3000`; `render.yaml` sets `PORT=10000`) | Must be valid port `1..65535`; also used by `Dockerfile` `HEALTHCHECK`. Must differ from `NEXT_INTERNAL_PORT` and `COLLAB_PORT`. |
| `HOSTNAME` | Bind address for `prod-entrypoint.mjs` public server and `collab-public` listener | Optional | Server-only | `0.0.0.0` (in `Dockerfile` & `prod-entrypoint.mjs`) | Keep `0.0.0.0` inside containers so Docker/Render port mapping can reach the process. |
| `NEXT_INTERNAL_PORT` | Internal loopback port on which Next.js standalone (`server.js`) listens behind `prod-entrypoint.mjs` | Optional | Server-only | `3001` | Must be valid port `1..65535` and not collide with `PORT` or `COLLAB_PORT`. |
| `COLLAB_PUBLIC_PORT` | Optional dedicated public WebSocket + `/health`/`/healthz` listener port started by `prod-entrypoint.mjs` (used when `ws://host:1234` and `http://host:3000` are split externally) | Optional | Server-only | Disabled (unset in `Dockerfile` and `render.yaml`) | In `docker-compose.prod.yml`, container sets `COLLAB_PUBLIC_PORT=1235` mapped from host `${COLLAB_PORT:-1234}:1235` so dual-port local Compose works cleanly. Leave unset on single-port Render Free. |

---

## 7. Docker Compose Variables (`docker-compose.prod.yml` only)

These variables parameterize `docker-compose.prod.yml` host orchestration and Postgres container bootstrap (never bundled into the application):

| Variable | Purpose | Required / Optional | Scope | Default in `docker-compose.prod.yml` | Production Requirements |
| --- | --- | --- | --- | --- | --- |
| `POSTGRES_USER` | Superuser role created inside the production `postgres` container | Optional (falls back to default) | Infra-only | `postgres` | Should be customized when exposing managed or persistent volumes. |
| `POSTGRES_PASSWORD` | Password for the production `postgres` container (must match password in `DATABASE_URL`) | **Required** (`:?` fails Compose interpolation if unset) | Infra-only | None (no default) | Strong random password; never commit `.env` with real value. |
| `POSTGRES_DB` | Initial PostgreSQL database name inside `postgres` container | Optional | Infra-only | `collab_workspace` | Must match DB name in `DATABASE_URL`. |
| `APP_PORT` | Host port mapped to container `PORT` (`3000`) in `docker-compose.prod.yml` | Optional | Infra-only | `3000` | Valid unprivileged host port. |
| `COLLAB_PORT` | Inside `docker-compose.prod.yml` port mapping (`${COLLAB_PORT:-1234}:1235`), sets host port for external WS connections while keeping internal `COLLAB_PORT=1234` in container | Optional | Infra-only | `1234` | Align with `NEXT_PUBLIC_COLLAB_WS_URL` host port in Compose builds. |

---

## 8. Internal / Framework-Set Variables (Do Not Configure Manually)

- `NEXT_RUNTIME`: Injected automatically by Next.js (`nodejs` or `edge`); `src/instrumentation.ts` runs startup env validation only when `NEXT_RUNTIME === 'nodejs'`.
- `NEXT_PHASE`: Injected automatically by Next.js during `next build` (`phase-production-build`); skips runtime-only `DATABASE_URL` strict enforcement when building static assets without a live DB.
- **Note on `render.yaml`**: `render.yaml` declares `INTERNAL_RPC_HOST=127.0.0.1` and `INTERNAL_RPC_PORT=1234` alongside `COLLAB_PORT=1234`. The application code (`src/server/collab-internal-client.mjs`) resolves the internal RPC target from `127.0.0.1` and `COLLAB_PORT` directly; `INTERNAL_RPC_HOST` and `INTERNAL_RPC_PORT` are informational/unused at runtime.

---

## 9. Validation Commands & Safe Error Behavior

Run preflight checks before booting or deploying:

```bash
# Development check (uses .env.local / .env)
npm run env:check

# Strict production simulation check (all targets: Next.js + Collab + Public URLs)
node scripts/validate_env.mjs --strict

# Collab-server-only check
node scripts/validate_env.mjs --target=collab --strict

# Automated secrets & URL redaction verification test suite
node scripts/verify_env_secrets.mjs
```

All validation errors and log messages obey secret-safety guarantees (`src/lib/env.mjs`):
- Credentialed PostgreSQL and Redis URLs pass through `redactConnectionUrl()`, replacing passwords with `***`.
- `validateAuthSecret()` and `validateInternalRpcSecretValue()` never echo secret values in thrown errors.

