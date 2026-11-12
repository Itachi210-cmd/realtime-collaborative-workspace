# HTTP API, Internal RPC & WebSocket Protocol Reference

This reference documents every implemented HTTP/SSE route in `src/app/api/**`, the loopback-only RPC interface in `src/server/collab-server.mjs`, and the WebSocket collaboration wire protocol.

---

## 1. Common Conventions

- **Authentication**: All authenticated Next.js routes read the `collab_session` HTTP-only JWT cookie via `getCurrentSession()` (`src/lib/auth/session.ts`). Missing/invalid cookies yield `401`.
- **CSRF Protection**: State-changing routes (`POST`, `PATCH`, `DELETE`) run `verifySameOriginCsrf(request)`, returning `403` if `Sec-Fetch-Site: cross-site` or if an explicit `Origin` header does not match `request.nextUrl.origin`, `NEXT_PUBLIC_APP_URL`, or forwarded host origins.
- **Payload Caps & Rate Limiting**: Oversized JSON bodies return `413`; malformed JSON returns `400`; Zod schema validation failures return `400` with details; rate-limit violations return `429` with `Retry-After`.
- **Error Format**: JSON `{ "error": string, "details"?: Record<string, string[]> }`.

---

## 2. Health & Readiness Endpoints

### `GET /api/health` (Next.js App Router)
Verifies PostgreSQL connectivity (`SELECT 1` with 2.5s timeout), optionally probes `collab-server.mjs` `/healthz` when `REDIS_ENABLED !== "false"` or when `COLLAB_PORT` responds, and checks runtime config. Returns `200` when ready or `503` (`status: "degraded"`) if DB/config/collab checks fail. Headers: `Cache-Control: no-store`.

### `GET /health` | `GET /healthz` (`src/server/collab-server.mjs`)
- Exposed internally on `127.0.0.1:${COLLAB_PORT}` and externally on `COLLAB_PUBLIC_PORT` (if configured).
- Returns `200` (`{ "status": "ok", "instanceId", "uptime", "roomsCount", "rooms", "database": { "healthy", "status" }, "redis": { "enabled", "healthy", "status" } }`) or `503` if shutting down (`status: "shutting_down"`), DB query fails, or `REDIS_ENABLED !== "false"` and Redis pub/sub clients are not `ready`.

---

## 3. Authentication Endpoints

| Method & Path | Auth | Limits & Caps | Request Body / Behavior | Responses |
| --- | --- | --- | --- | --- |
| `POST /api/auth/register` | Public | 15 req / 15m per IP, 16 KB | `{ name: string (1..100), email: string, password: string (8..128) }` (`registerSchema`). Normalizes email lowercase; hashes password with `bcryptjs`; creates personal `"<Name>'s Workspace"` + `OWNER` `WorkspaceMember`; sets `collab_session` cookie. | `201 { user, workspace }`, `400`, `403` (CSRF), `409` (email exists), `413`, `429` |
| `POST /api/auth/login` | Public | 20 req / 15m per IP, 16 KB | `{ email: string, password: string }` (`loginSchema`). Sets `collab_session` HTTP-only cookie (`7d`). | `200 { user }`, `400`, `401`, `403`, `413`, `429` |
| `POST /api/auth/logout` | Cookie optional | — | Clears `collab_session` cookie. | `200 { success: true }`, `403` (CSRF) |
| `GET /api/auth/me` | Session required | — | Loads fresh user record + owned/member workspace summary from DB (revokes stale session with `401` if user missing). | `200 { user, workspaces }`, `401` (`no-store`) |

---

## 4. Workspace Endpoints

| Method & Path | Auth / Role | Limits & Caps | Request / Query & Behavior | Responses |
| --- | --- | --- | --- | --- |
| `GET /api/workspaces` | Session | — | Lists workspaces where user is `ownerId` or a `WorkspaceMember` (including current role and member/page counts). Supports optional `?limit=` (default `100`, max `200`; `no-store`). | `200 { workspaces }`, `401` |
| `POST /api/workspaces` | Session | 20 req / 1m per user, 16 KB | `{ name: string (1..100) }` (`createWorkspaceSchema`). Creates workspace + initial `OWNER` `WorkspaceMember` + starter `Page`. | `201 { workspace }`, `400`, `401`, `403`, `413`, `429` |
| `GET /api/workspaces/[workspaceId]` | Any member | — | Returns workspace metadata, current user's role, members summary, and page count (`no-store`). | `200 { workspace, role }`, `401`, `403`, `404` |
| `PATCH /api/workspaces/[workspaceId]` | `OWNER` only | — | `{ name: string (1..100) }` (`updateWorkspaceSchema`). Renames workspace (`no-store`). | `200 { workspace }`, `400`, `401`, `403`, `404` |
| `DELETE /api/workspaces/[workspaceId]` | `OWNER` only | — | Deletes workspace and cascades members, pages, document states, comments, and snapshots (`no-store`). | `200 { success: true }`, `401`, `403`, `404` |

---

## 5. Workspace Member & Permission Endpoints

| Method & Path | Auth / Role | Limits & Caps | Request / Behavior | Responses |
| --- | --- | --- | --- | --- |
| `GET /api/workspaces/[workspaceId]/members` | Any member | — | Lists workspace members with user id, name, email, role, joinedAt (`no-store`). | `200 { members }`, `401`, `403`, `404` |
| `POST /api/workspaces/[workspaceId]/members` | `OWNER` only | 30 req / 1m per user, 16 KB | `{ email: string, role: "EDITOR" \| "COMMENTER" \| "VIEWER" }` (`inviteMemberSchema`). Looks up existing registered user by email and creates `WorkspaceMember`. | `201 { member }`, `400`, `401`, `403`, `404` (user/ws), `409` (already member), `413`, `429` |
| `PATCH /api/workspaces/[workspaceId]/members/[memberId]` | `OWNER` only | — | `{ role: "EDITOR" \| "COMMENTER" \| "VIEWER" }` (`updateMemberRoleSchema`). Updates role; prevents demoting/removing the workspace `OWNER`. | `200 { member }`, `400`, `401`, `403`, `404` |
| `DELETE /api/workspaces/[workspaceId]/members/[memberId]` | `OWNER` (or self-removal) | — | Removes member from workspace; cannot remove the workspace `OWNER`. | `200 { success: true }`, `401`, `403`, `404` |

---

## 6. Document Pages, SSE Tree Stream & Collab Token Endpoints

| Method & Path | Auth / Role | Limits & Caps | Request / Behavior | Responses |
| --- | --- | --- | --- | --- |
| `GET /api/workspaces/[workspaceId]/pages` | Any member | — | Lists page metadata in workspace (excludes heavy `content` JSONB) ordered for sidebar tree rendering. Supports optional `?limit=` (default `250`, max `500`; `no-store`). | `200 { pages }`, `401`, `403`, `404` |
| `POST /api/workspaces/[workspaceId]/pages` | `OWNER` or `EDITOR` | — | `{ title?: string (1..200), parentPageId?: string \| null, content?: any }` (`createPageSchema`). Validates `parentPageId` belongs to the same workspace and emits `PAGE_CREATED` SSE event. | `201 { page }`, `400`, `401`, `403`, `404` |
| `GET /api/workspaces/[workspaceId]/pages/events` | Any member | — | Opens `text/event-stream` (`Cache-Control: no-store`). Sends `{ type: "CONNECTED", workspaceId }`, `25s` keepalive comments, and emits `PAGE_CREATED` / `PAGE_UPDATED` / `PAGE_DELETED` from in-memory `workspaceEvents`. | `200 SSE stream`, `401`, `403`, `404` |
| `GET /api/workspaces/[workspaceId]/pages/[pageId]` | Any member | — | Returns page details, permissions flags (`canEdit`, `canComment`, `role`), and document metadata (`no-store`). | `200 { page, ... }`, `401`, `403`, `404` |
| `PATCH /api/workspaces/[workspaceId]/pages/[pageId]` | `OWNER` or `EDITOR` | — | `{ title?: string, parentPageId?: string \| null, content?: any }` (`updatePageSchema`). Prevents circular parent hierarchy; emits `PAGE_UPDATED` SSE event. | `200 { page }`, `400`, `401`, `403`, `404` |
| `DELETE /api/workspaces/[workspaceId]/pages/[pageId]` | `OWNER` or `EDITOR` | — | Deletes page and cascaded descendants; emits `PAGE_DELETED` SSE event. | `200 { success: true }`, `401`, `403`, `404` |
| `POST /api/workspaces/[workspaceId]/pages/[pageId]/collab-token` | Any member | 60 req / 1m per user | Issues a 60s HS256 JWT (`iss: "collab-workspace-auth"`, `aud: "collab-workspace-yjs"`, `purpose: "collaboration"`, `role`, `pageId`, `workspaceId`, `userName`, `userColor`). Rate-limited & `no-store`. | `200 { token, expiresIn: 60, role }`, `401`, `403`, `404`, `429` |

---

## 7. Comments Endpoints

| Method & Path | Auth / Role | Limits & Caps | Request / Behavior | Responses |
| --- | --- | --- | --- | --- |
| `GET /api/workspaces/[workspaceId]/pages/[pageId]/comments` | Any member | — | Lists comments for page sorted by `createdAt` ascending with author summary. Supports optional `?limit=` (default `200`, max `500`; `no-store`). | `200 { comments }`, `401`, `403`, `404` |
| `POST /api/workspaces/[workspaceId]/pages/[pageId]/comments` | `OWNER`, `EDITOR`, `COMMENTER` | 60 req / 1m per user, 64 KB | `{ body: string (1..5000), anchor?: { from?: number, to?: number, quote?: string } }` (`createCommentSchema`). Rejects `VIEWER` with `403`. | `201 { comment }`, `400`, `401`, `403`, `404`, `413`, `429` |
| `PATCH /api/workspaces/[workspaceId]/pages/[pageId]/comments/[commentId]` | `OWNER`, or author (`EDITOR`/`COMMENTER`) | — | `{ body?: string (1..5000), resolved?: boolean }` (`updateCommentSchema`). Author can edit/resolve own comment; `OWNER` can edit/resolve any comment in workspace. | `200 { comment }`, `400`, `401`, `403`, `404` |
| `DELETE /api/workspaces/[workspaceId]/pages/[pageId]/comments/[commentId]` | `OWNER`, or author (`EDITOR`/`COMMENTER`) | — | Deletes comment record. Author or `OWNER` only. | `200 { success: true }`, `401`, `403`, `404` |

---

## 8. Version History & Restore Endpoints

| Method & Path | Auth / Role | Limits & Caps | Request / Behavior | Responses |
| --- | --- | --- | --- | --- |
| `GET /api/workspaces/[workspaceId]/pages/[pageId]/versions` | Any member | — | Lists bounded snapshot summaries (`label`, `description`, `wordCount`, `isAutomatic`, `createdBy`, `createdAt`; omits raw `yjsState` binary). Supports `?limit=` (default `50`, max `100`; `no-store`). | `200 { versions }`, `401`, `403`, `404` |
| `POST /api/workspaces/[workspaceId]/pages/[pageId]/versions` | `OWNER` or `EDITOR` | 30 req / 1m per user | `{ label?: string (1..120), description?: string (..500) }` (`createSnapshotSchema`). First attempts loopback RPC `POST /internal/rooms/:pageId/flush` to flush active in-memory edits to PostgreSQL, then creates `VersionSnapshot`. | `201 { version }`, `400`, `401`, `403`, `404`, `429` |
| `GET /api/workspaces/[workspaceId]/pages/[pageId]/versions/[versionId]` | Any member | — | Returns snapshot metadata + TipTap JSON preview (`content`) without raw `yjsState` bytes (`no-store`). | `200 { version }`, `401`, `403`, `404` |
| `POST /api/workspaces/[workspaceId]/pages/[pageId]/versions/[versionId]/restore` | `OWNER` or `EDITOR` | 15 req / 1m per user | Calls loopback RPC `POST /internal/rooms/:pageId/restore` (`{ versionId, userId }`) so an active collaboration room creates a safety auto-snapshot, restores `DocumentState` + `Page.content` transactionally, updates live `Y.Doc`, and broadcasts to connected clients. Falls back to direct DB transactional restore if no active collaboration room exists (`no-store`). | `200 { restoredVersionId, safetySnapshot, stateVersion }`, `401`, `403`, `404`, `429` |

---

## 9. Internal Loopback RPC Interface (`collab-server.mjs`)

Restricted by:
1. Remote address check (`127.0.0.1`, `::1`, `::ffff:127.0.0.1`, `localhost`).
2. `Authorization: Bearer <64-hex INTERNAL_RPC_SECRET>` verified via `crypto.timingSafeEqual`.
3. `prod-entrypoint.mjs` proxy additionally returns `403` on any external `/internal*` path.

| Method & Path | Body | Response |
| --- | --- | --- |
| `POST /internal/rooms/:pageId/flush` | Empty | `200 { success: true, active: boolean, flushed: boolean, pageId, stateVersion? }`, `401`, `403`, `405`, `500` |
| `POST /internal/rooms/:pageId/restore` | `{ "versionId": string, "userId"?: string \| null }` | `200 { success: true, active: boolean, pageId, restoredVersionId, safetySnapshot, stateVersion }`, `400`, `401`, `403`, `404`, `405`, `409` (restore lock contention), `413`, `500` |

---

## 10. WebSocket Collaboration Protocol (`src/server/collab-server.mjs`)

- **Connection Paths Accepted**: `/:pageId`, `/rooms/:pageId`, `/room/:pageId`, `/collab-ws/:pageId`, or `?room=<pageId>`.
- **Upgrade Security**:
  - `Origin` header (when present) must be in `COLLAB_ALLOWED_ORIGINS` (or `403`).
  - Query parameters `?token=`, `?jwt=`, `?auth=` are rejected immediately with HTTP `400`.
  - Max WebSocket frame size: `2 MiB` (`maxPayload`).
  - Server-side `ping`/`pong` heartbeat every `30s`.
- **First-Message Authentication** (within `COLLAB_AUTH_TIMEOUT_MS`, default `5000ms`):
  - Client sends JSON text frame `{ "type": "auth", "token": "<collab-jwt>" }` (implemented in `src/lib/collab/authenticated-transport.mjs`) OR binary `lib0` `MESSAGE_AUTH (2)` frame.
  - Unauthenticated, expired, wrong-`pageId`, or invalid-role connections receive JSON `permission_denied` and close with `4401` / `4403`.
- **Server -> Client Control Frames (JSON Text)**:
  - `{ "type": "authenticated", "pageId", "user", "stateVersion", "saveStatus" }`
  - `{ "type": "save_status", "status": "saving" | "saved" | "error", "pageId", "stateVersion"?, "savedAt"?, "error"? }`
  - `{ "type": "pong" }` (reply to `{ "type": "ping" }`)
  - `{ "type": "permission_denied", "reason", "role"? }`
- **Client <-> Server Binary Yjs Frames (`lib0` varUint prefix)**:
  - `0` (`MESSAGE_SYNC`): Sync Step 1 (`0`, allowed all roles), Sync Step 2 (`1`) & Incremental Update (`2`) allowed for `OWNER`/`EDITOR`, dropped + `permission_denied` for `COMMENTER`/`VIEWER`.
  - `1` (`MESSAGE_AWARENESS`): Live cursor/presence state. Server calls `sanitizeAwarenessUpdate()` so `userId`, `name`, and `role` cannot be spoofed.
  - `3` (`MESSAGE_QUERY_AWARENESS`): Server replies with current encoded room awareness states.
