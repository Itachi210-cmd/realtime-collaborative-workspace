# syntax=docker/dockerfile:1

FROM node:22-alpine AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# 1. Install dependencies once from package-lock.json
FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund

# 2. Generate Prisma Client, build Next.js standalone bundle, and prune collab-server deps
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json next.config.ts tsconfig.json prisma.config.ts ./
COPY prisma ./prisma
COPY public ./public
COPY src ./src

# Non-secret public client URLs bundled at Next.js build time (never pass secrets here)
ARG NEXT_PUBLIC_APP_URL=http://localhost:3000
ARG NEXT_PUBLIC_COLLAB_WS_URL=ws://localhost:1234
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}
ENV NEXT_PUBLIC_COLLAB_WS_URL=${NEXT_PUBLIC_COLLAB_WS_URL}

RUN npx prisma generate && npm run build

# Collect ONLY the locked runtime packages imported by collab-server.mjs (Next.js standalone
# traces its own Next/React/Prisma WASM subset separately in .next/standalone/node_modules).
RUN mkdir -p /collab-runtime/node_modules && node -e "\
const fs = require('fs'); \
const path = require('path'); \
const roots = ['ws', 'ioredis', 'jose', 'yjs', 'y-protocols', 'lib0', '@tiptap/core', '@tiptap/starter-kit', '@tiptap/y-tiptap', '@prisma/adapter-pg', 'pg']; \
const seen = new Set(); \
const queue = [...roots]; \
while (queue.length > 0) { \
  const pkgName = queue.shift(); \
  if (pkgName === '@prisma/client' || seen.has(pkgName)) continue; \
  const pkgJsonPath = path.join('/app/node_modules', pkgName, 'package.json'); \
  if (!fs.existsSync(pkgJsonPath)) continue; \
  seen.add(pkgName); \
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8')); \
  for (const dep of Object.keys(pkg.dependencies || {})) queue.push(dep); \
} \
for (const pkgName of seen) { \
  const srcDir = path.join('/app/node_modules', pkgName); \
  const dstDir = path.join('/collab-runtime/node_modules', pkgName); \
  fs.mkdirSync(path.dirname(dstDir), { recursive: true }); \
  fs.cpSync(srcDir, dstDir, { recursive: true, dereference: true }); \
} \
console.log('Pruned collab runtime packages:', seen.size);"

# 3. Minimal non-root production runtime image
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV COLLAB_PORT=1234
ENV COLLAB_HOST=127.0.0.1
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 --ingroup nodejs nextjs

# Copy pruned collab runtime deps, then overlay Next.js standalone traced node_modules
COPY --from=builder --chown=nextjs:nodejs /collab-runtime/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json

# Next.js standalone runtime bundle + static assets + public directory
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone/server.js ./server.js
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone/.next ./.next
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Dedicated Yjs WebSocket collaboration server + shared env/logger utilities + supervisor entrypoint
COPY --chown=nextjs:nodejs src/server ./src/server
COPY --chown=nextjs:nodejs src/lib/env.mjs ./src/lib/env.mjs
COPY --chown=nextjs:nodejs src/lib/logger.mjs ./src/lib/logger.mjs
COPY --chown=nextjs:nodejs scripts/prod-entrypoint.mjs ./scripts/prod-entrypoint.mjs

USER nextjs

EXPOSE 3000
STOPSIGNAL SIGTERM

HEALTHCHECK --interval=15s --timeout=5s --start-period=25s --retries=4 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "scripts/prod-entrypoint.mjs"]
