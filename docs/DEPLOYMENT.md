# Deployment & Operations Runbook

This guide provides reproducible instructions for running **Real-Time Collaborative Workspace** locally, in production Docker Compose, and on a strict **₹0 budget** cloud stack (**Render Free Web Service + Neon Free PostgreSQL**).

---

## 1. Local Development Runbook

### Prerequisites
- **Node.js 22.x** (matching `node:22-alpine` in `Dockerfile`) and `npm`
- **Docker Desktop** (for local PostgreSQL 16 + Redis 7 via `docker-compose.yml`), OR local PostgreSQL 16 and Redis 7 installs

### Step-by-Step Setup

1. **Install dependencies**:
   ```bash
   npm ci
   ```

2. **Start local database & Redis** (`docker-compose.yml` preserves persistent named volumes `postgres_data` and `redis_data`):
   ```bash
   docker compose up -d
   ```

3. **Configure environment variables**:
   Copy `.env.example` to `.env.local` (never edit `.env.example` with real secrets):
   - Set `DATABASE_URL="postgresql://postgres:postgres@localhost:5432/collab_workspace?schema=public"`
   - Generate 32+ char `AUTH_SECRET` and 64-hex `INTERNAL_RPC_SECRET`:
     ```bash
     node -e "console.log('AUTH_SECRET=' + require('crypto').randomBytes(48).toString('base64url')); console.log('INTERNAL_RPC_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"
     ```
   - Also keep `DATABASE_URL` available in `.env` or shell environment for Prisma CLI commands (`npx prisma migrate deploy`, etc.), since `prisma.config.ts` / CLI reads `.env` by default.

4. **Validate environment variables & run migrations**:
   ```bash
   npm run env:check
   npx prisma generate
   npx prisma migrate deploy
   ```

5. **Run both processes in separate terminals**:
   - Terminal 1 (Next.js App Router on `http://localhost:3000`):
     ```bash
     npm run dev
     ```
   - Terminal 2 (Dedicated Yjs WebSocket Server on `ws://localhost:1234`):
     ```bash
     npm run collab
     ```

6. **Verify local health**:
   - Web app health: `GET http://localhost:3000/api/health` -> `200 OK`
   - Collab server health: `GET http://localhost:1234/healthz` -> `200 OK`

---

## 2. Production Docker / Compose Runbook (Full Stack with Redis)

[`docker-compose.prod.yml`](file:///d:/NT%20PROJECTS/Real-Time%20Collaborative%20Workspace/docker-compose.prod.yml) runs three services on an isolated network topology:
- `postgres` (`postgres:16-alpine`, internal network only, `pg_isready` healthcheck, persistent `pgdata_prod` volume)
- `redis` (`redis:7-alpine`, AOF persistence, `128mb` memory limit with `noeviction`, internal network only)
- `app` (built from `Dockerfile`, non-root user `nextjs`, runs `scripts/prod-entrypoint.mjs`)

### Deployment Steps

1. **Create `.env` (or shell env) for Compose interpolation** (never commit `.env`):
   ```env
   POSTGRES_USER=postgres
   POSTGRES_PASSWORD=<strong-random-db-password>
   POSTGRES_DB=collab_workspace
   DATABASE_URL=postgresql://postgres:<strong-random-db-password>@postgres:5432/collab_workspace?schema=public
   AUTH_SECRET=<48-byte-base64url-secret>
   INTERNAL_RPC_SECRET=<64-hex-chars-secret>
   NEXT_PUBLIC_APP_URL=http://localhost:3000
   NEXT_PUBLIC_COLLAB_WS_URL=ws://localhost:1234
   COLLAB_ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
   REDIS_ENABLED=true
   REDIS_URL=redis://redis:6379
   ```

2. **Validate Compose & build image**:
   ```bash
   docker compose -f docker-compose.prod.yml config --quiet
   docker compose -f docker-compose.prod.yml build
   ```

3. **Apply Prisma migrations before or during startup**:
   Start Postgres first and run `npx prisma migrate deploy` against `DATABASE_URL` (one-off container or local CLI if port temporarily bound), then start the stack:
   ```bash
   docker compose -f docker-compose.prod.yml up -d
   ```

4. **Inspect health & logs**:
   ```bash
   docker compose -f docker-compose.prod.yml ps
   docker compose -f docker-compose.prod.yml logs -f app
   ```
   - `GET http://localhost:3000/api/health` -> `200 OK`
   - `GET http://localhost:1234/healthz` -> `200 OK`

5. **Graceful shutdown** (`SIGTERM` triggers room flush inside `collab-server.mjs` within the `30s` `stop_grace_period`):
   ```bash
   docker compose -f docker-compose.prod.yml down
   ```
   > **Warning**: Never pass `-v` unless you intentionally want to wipe `pgdata_prod` and `redis_prod` volumes.

---

## 3. Cloud Free-Tier Deployment Runbook: Render Free + Neon Free (₹0 Budget)

> **Release Status: PENDING USER ACTION**
> Code, `Dockerfile`, `scripts/prod-entrypoint.mjs`, and `render.yaml` are prepared in the repository. Live provisioning on Neon and Render has **not** been executed in this workspace.

### Why Single-Container Render Free (`render.yaml`)?
- Render Free Web Services support Docker images, HTTPS ingress (`wss://` WebSocket upgrades on the same service URL), and zero credit-card cost (within free-tier limits).
- [`render.yaml`](file:///d:/NT%20PROJECTS/Real-Time%20Collaborative%20Workspace/render.yaml) sets `REDIS_ENABLED=false`, `PG_POOL_MAX=5`, `PORT=10000`, `NEXT_INTERNAL_PORT=3001`, and `COLLAB_PORT=1234`, multiplexing Next.js HTTP/SSE and Yjs WebSockets on `https://<service>.onrender.com` / `wss://<service>.onrender.com/collab-ws`.
- Because `REDIS_ENABLED=false`, multi-instance horizontal scaling must remain disabled (`1` instance max). All collaboration rooms, presence, and debounced saves still work inside that single instance.

### Step 1: Provision Neon Free PostgreSQL (User Action)
1. Create a free project in **Neon** (`PostgreSQL 16`).
2. Copy the **pooled** or direct TLS connection string (`sslmode=require` is required in production by `src/lib/env.mjs`):
   `postgresql://<user>:<password>@<neon-host>/<db>?sslmode=require`
3. From your local machine (with the Neon URL temporarily exported in your terminal only), apply Prisma migrations:
   ```bash
   npx prisma migrate deploy
   ```

### Step 2: Deploy Blueprint on Render Free (User Action)
1. Push your approved repository to GitHub/GitLab.
2. In Render Dashboard -> **New +** -> **Blueprint**, select the repo (`render.yaml` is at repo root).
3. Populate the six `sync: false` secrets/URLs in Render Environment Settings:
   - `DATABASE_URL`: Neon TLS connection string (`?sslmode=require`)
   - `AUTH_SECRET`: 48-byte random `base64url` string
   - `INTERNAL_RPC_SECRET`: 64-char random lowercase hex string
   - `NEXT_PUBLIC_APP_URL`: `https://<your-render-service>.onrender.com`
   - `NEXT_PUBLIC_COLLAB_WS_URL`: `wss://<your-render-service>.onrender.com/collab-ws`
   - `COLLAB_ALLOWED_ORIGINS`: `https://<your-render-service>.onrender.com`
4. Trigger **Deploy** (Docker build runs `npx prisma generate && npm run build` and starts `node scripts/prod-entrypoint.mjs`).

### Step 3: Post-Deploy Smoke Checks (User Action)
1. `GET https://<your-render-service>.onrender.com/api/health` -> verify `200 OK` (`database.healthy: true`, `collab.healthy: true`).
2. Sign up -> create workspace & page -> type in TipTap -> verify "Saved" status badge -> hard refresh and verify persisted content reloads.
3. Open a second browser session -> verify real-time typing, cursor presence badge, comment creation, manual version snapshot, and version restore.

### Backup & Rollback Precautions
- **Before deploying migrations**: Always verify Neon branch/point-in-time snapshot or export a `pg_dump` backup (`pg_dump "$DATABASE_URL" > backup.sql`).
- **Rollback**: Use Render's **Manual Deploy -> Redeploy previous commit** if an application image introduces regressions (only run backward-compatible Prisma migrations).
- **Free-Tier Sleep Behavior**: Render Free spins down after ~15 minutes of inactivity. When idle clients disconnect, `collab-server.mjs` flushes dirty rooms within `COLLAB_CLEANUP_GRACE_MS` (`30s`) and on `SIGTERM` shutdown; cold starts take ~30–60s on first HTTP request after sleep.

