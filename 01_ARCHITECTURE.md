# Real-Time Collaborative Workspace --- Architecture Blueprint

**Project type:** Full-Stack Development Internship\
**Project window:** 20 October 2026 -- 20 November 2026\
**Estimated effort:** 14 focused development days\
**Budget rule:** ₹0 target. Do not activate paid plans, paid trials, or
paid resources without explicit approval.

## 1. Architecture Goals

Build a Notion-inspired collaborative workspace where authenticated
users can create workspaces and pages, edit the same rich-text document
simultaneously, see live presence/cursors, comment, inspect version
history, and use role-based permissions.

The architecture must: - Use the assigned stack: Next.js, WebSockets,
Yjs (CRDT), PostgreSQL, Redis, and Prisma. - Persist application records
and collaborative document state. - Handle concurrent edits without
relying on last-write-wins replacement. - Support local development
first and a best-effort free-tier deployment later. - Keep paid services
optional and disabled by default.

## 2. High-Level Architecture

``` text
Browser A ─┐                         ┌─────────────────────────┐
Browser B ─┼── HTTPS ───────────────►│ Vercel: Next.js web app │
Browser C ─┘                         └────────────┬────────────┘
                                                  │ HTTPS API
                                                  ▼
                                       ┌────────────────────────┐
                                       │ Backend/API service    │
                                       │ Next.js route handlers │
                                       │ or dedicated Node API  │
                                       └──────┬─────────┬───────┘
                                              │         │
                                  Prisma      │         │ WebSocket URL
                                              ▼         ▼
                                     ┌────────────┐  ┌───────────────────┐
                                     │ PostgreSQL │  │ y-websocket server│
                                     │ app data + │  │ Yjs sync/presence │
                                     │ snapshots  │  └─────────┬─────────┘
                                     └────────────┘            │
                                                               ▼
                                                    ┌────────────────────┐
                                                    │ Redis coordination │
                                                    │ for multi-instance │
                                                    └────────────────────┘
```

**Important deployment note:** The diagram is logical, not a requirement
to deploy every component separately. Start with one local application
and one WebSocket server. Add Redis-backed multi-instance coordination
only after single-server collaboration works. Vercel is suitable for the
Next.js web app, but do not assume it can host a permanent WebSocket
server. Use a service that explicitly supports long-lived WebSocket
connections for that component.

## 3. Technology Responsibilities

  -----------------------------------------------------------------------
  Technology                          Responsibility
  ----------------------------------- -----------------------------------
  Next.js + TypeScript                UI, routes, server-rendered pages,
                                      API endpoints where appropriate

  TipTap                              Rich-text editor UI and formatting

  Yjs                                 CRDT document model and merging
                                      concurrent edits

  y-websocket                         WebSocket transport/provider for
                                      Yjs document updates and awareness

  PostgreSQL                          Users, workspaces, memberships,
                                      pages, comments, snapshots, audit
                                      metadata

  Prisma                              Schema, migrations, type-safe
                                      database access

  Redis                               Cross-instance
                                      coordination/broadcasting when a
                                      compatible provider is configured

  Vercel                              Next.js frontend hosting, subject
                                      to current free-tier limits

  Render or equivalent                Backend/WebSocket hosting only if
                                      the current plan supports the
                                      required connection behaviour
  -----------------------------------------------------------------------

## 4. Data Separation

### Application data (PostgreSQL via Prisma)

Store: - User identity/profile fields and password hash or
identity-provider reference. - Workspaces and workspace membership. -
Page title, parent page, workspace, creator, timestamps. - Roles and
access permissions. - Comments and comment threads. - Version snapshot
metadata and stored snapshot payloads. - Audit events where useful.

### Collaborative document data (Yjs)

Yjs state is not the same thing as a page title or ordinary JSON field.
Implement persistence for Yjs updates or encoded document snapshots. A
practical MVP option is a PostgreSQL table keyed by page ID that stores
the latest encoded Yjs state plus optional update records. Use
binary-safe storage (`BYTEA`) or a documented encoding such as base64 if
the implementation layer requires text. Avoid repeatedly overwriting a
document with stale HTML from a client.

### Recovery behaviour

1.  A user opens a page.
2.  The server authenticates the user and checks workspace/page
    permission.
3.  The stored Yjs state is loaded into a Y.Doc.
4.  The browser connects to the collaboration server.
5.  Updates synchronize and merge through Yjs.
6.  Updates are persisted on a controlled schedule and/or on update
    events.
7.  After reconnect or server restart, the latest persisted state is
    loaded.

The exact persistence adapter must be tested for correctness and
graceful shutdown. In-memory-only Yjs state is not acceptable for the
final demo because it can disappear when the server restarts.

## 5. Authentication and Authorization

-   Use a maintained authentication approach compatible with Next.js.
-   Store secrets in environment variables; never commit `.env` files.
-   Hash passwords with a standard password-hashing library if
    implementing password authentication directly.
-   Check authorization on the server for every workspace/page
    operation.
-   Check permission before joining a Yjs room; a hidden UI button is
    not security.
-   Do not trust a client-supplied user ID, role, workspace ID, or page
    ID without server-side validation.
-   Define roles:
    -   **Owner:** manage workspace, members, and all pages.
    -   **Editor:** read and edit pages.
    -   **Commenter:** read pages and add comments, but not edit
        document content.
    -   **Viewer:** read-only.
-   For WebSocket authentication, validate a short-lived token or secure
    session on connection. Avoid putting long-lived secrets in query
    strings.

## 6. Suggested Prisma Entities

Initial schema concepts (field names can be refined during
implementation):

-   `User`: id, name, email, passwordHash or auth reference, createdAt,
    updatedAt.
-   `Workspace`: id, name, ownerId, createdAt, updatedAt.
-   `WorkspaceMember`: id, workspaceId, userId, role, joinedAt.
-   `Page`: id, workspaceId, parentPageId nullable, title, createdById,
    createdAt, updatedAt.
-   `DocumentState`: pageId (unique), yjsState (BYTEA), stateVersion,
    updatedAt.
-   `DocumentUpdate` (optional event log): id, pageId, updateBytes,
    createdAt.
-   `Comment`: id, pageId, authorId, body, anchor metadata nullable,
    resolvedAt nullable, createdAt, updatedAt.
-   `VersionSnapshot`: id, pageId, createdById, label nullable,
    snapshotBytes or serialized state, createdAt.
-   `AuditEvent` (optional): id, actorId, workspaceId, pageId nullable,
    action, metadata JSON, createdAt.

Use foreign keys, indexes for workspace/page membership lookups, unique
constraints for email and workspace membership, and cascade rules that
do not accidentally delete shared data.

## 7. WebSocket and Redis Design

### First milestone: one server

-   Use `y-websocket` with a persistent Yjs document adapter.
-   Use one logical room per page, with a stable, non-guessable page
    identifier.
-   Authenticate and authorize every room join.
-   Test two or more browser sessions before introducing Redis.

### Scaling milestone: Redis

-   Add Redis only after single-server sync and persistence are stable.
-   Configure a compatible Yjs/WebSocket provider or cross-instance
    pub/sub adapter. The standard `y-websocket` server should not be
    assumed to gain multi-instance support just because Redis is
    installed.
-   Ensure updates and awareness/presence messages are handled correctly
    across instances.
-   Verify that clients connected to different server instances see the
    same document state.
-   If free hosted Redis is unavailable, use local Redis during
    development and document the deployment limitation rather than
    paying.

## 8. Free-First Deployment Strategy

-   **Development:** all services local; no card details or paid trials.
-   **Frontend:** try Vercel free tier, after checking current terms.
-   **WebSocket/API service:** try Render free tier or another free
    service only if it explicitly supports the needed WebSocket
    behaviour.
-   **Database:** use local PostgreSQL during development; choose a
    currently available free hosted PostgreSQL option only after
    checking storage, sleep, connection, and expiry limits.
-   **Redis:** local/self-hosted for development; use a verified free
    hosted plan only if available and suitable.
-   Do not assume all free tiers can be combined into a reliable
    always-on production setup. Free services may sleep, have limited
    resources, or change their terms.
-   If public deployment cannot be achieved at ₹0, submit a
    screen-recorded local demo as the fallback allowed by the brief.

## 9. Environment Variables

Example names only; populate locally and never commit secrets:

``` env
DATABASE_URL=
AUTH_SECRET=
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_COLLAB_URL=ws://localhost:1234
COLLAB_PORT=1234
REDIS_URL=
```

Production URLs should use `https://` and `wss://` where appropriate. Do
not expose database credentials or Redis secrets through `NEXT_PUBLIC_`
variables.

## 10. Architecture Acceptance Checks

-   Two browser sessions can edit the same page without refresh.
-   Simultaneous edits converge to the same document state.
-   Reconnect does not duplicate or lose document content.
-   Restarting the collaboration server does not erase persisted
    content.
-   Viewer cannot edit; commenter can comment but cannot edit; editor
    can edit.
-   Unauthorized users cannot join a page room by guessing its ID.
-   Redis multi-instance test passes when the scaling phase is enabled.
-   No paid service or resource is activated.
