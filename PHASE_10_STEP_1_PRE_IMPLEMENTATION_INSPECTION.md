# Phase 10 — Step 1: Pre-Implementation Inspection Report
## Version History & Document Snapshots

**Project:** Real-Time Collaborative Workspace (Notion/Figma-Style Editor)  
**Date:** November 7, 2026  
**Status:** Inspection Complete — Strictly Read-Only  
**Author:** Antigravity AI Assistant  

---

## 1. Existing Architecture Findings

The codebase was comprehensively audited against the four canonical blueprints (`01_ARCHITECTURE.md`, `02_UI_DESIGN_WORKFLOW.md`, `03_DEVELOPMENT_PHASES.md`, `04_PRD.md`) and the completed Phase 1–9 implementations.

### Key Architectural Characteristics
1. **Next.js 16 + React 19 + TipTap 3.32.2:**
   - Client editor in [`RichTextEditor.tsx`](file:///d:/NT%20PROJECTS/Real-Time%20Collaborative%20Workspace/src/components/editor/RichTextEditor.tsx) uses `@tiptap/react` configured with `@tiptap/extension-collaboration` bound to an in-memory `Y.Doc`.
   - `RichTextEditor` maintains an in-memory `Y.Doc` instance per `pageId`, synchronized over WebSocket to a dedicated collaboration server.
2. **Dedicated Yjs WebSocket Server (`src/server/collab-server.mjs`):**
   - Runs as a standalone Node.js ES module listening on port 1234 (configurable for tests).
   - Enforces first-message JWT authentication, dual-stack IPv4/IPv6 support, and strict room isolation.
   - Implements **Model B** authorization: all four workspace roles (`OWNER`, `EDITOR`, `COMMENTER`, `VIEWER`) connect and observe live updates and remote cursors; `COMMENTER` and `VIEWER` binary edits are dropped at the transport boundary before modifying `room.doc`.
   - Manages room lifecycle with in-memory room pooling and a 30-second cleanup grace timer when the last client disconnects.
3. **Database Schema (`prisma/schema.prisma`):**
   - PostgreSQL 16 managed via Prisma 7.10.1 with `@prisma/adapter-pg`.
   - Existing models: `User`, `Workspace`, `WorkspaceMember`, `Page`, `DocumentState`, `Comment`.
   - Current persistence table `document_states`:
     - `pageId`: Unique foreign key to `Page(id)` with `onDelete: Cascade`.
     - `yjsState`: PostgreSQL `BYTEA` storing binary updates encoded with `Y.encodeStateAsUpdate(doc)`.
     - `stateVersion`: Monotonically incremented integer counter.
4. **Authentication & Authorization (`src/lib/auth/`):**
   - Session authenticated via `collab_session` HTTP-only cookie containing signed HS256 JWT (7-day validity).
   - Workspace access controlled through [`checkWorkspaceAccess()`](file:///d:/NT%20PROJECTS/Real-Time%20Collaborative%20Workspace/src/lib/auth/workspace-auth.ts), preventing Insecure Direct Object Reference (IDOR) attacks across all endpoints.
   - Short-lived 60-second collaboration tokens minted via `POST /api/workspaces/[workspaceId]/pages/[pageId]/collab-token` with database-verified user claims.

---

## 2. Current Persistence Flow

Understanding the current persistence flow is critical to ensuring version history snapshots remain 100% consistent with live collaboration:

```
[TipTap Editor]
       │
       ▼ (Yjs binary update via WebSocket)
[CollabServer: collab-server.mjs]
       │
       ├─► Broadcast update to connected peers (SyncStep2 / Update)
       ├─► Set room.hasUnsavedChanges = true
       ├─► Broadcast { type: 'save_status', status: 'saving' }
       │
       ▼ scheduleSave(pageId, doc)
[Persistence Module: collab-persistence.mjs]
       │
       ├─► Debounce: 1500ms trailing delay (5000ms max wait ceiling)
       ├─► Write Queue: Per-document sequential promise chain (writeQueues Map)
       │
       ▼ executeSaveDirect(pageId, doc)
[PostgreSQL Database]
       │
       ├─► Upsert DocumentState:
       │     - yjsState = Buffer.from(Y.encodeStateAsUpdate(doc)) (BYTEA)
       │     - stateVersion = { increment: 1 }
       │
       └─► Dual-Write Page.content:
             - Converts doc.getXmlFragment('default') to TipTap JSON
             - Updates Page.content for lightweight search / read-only fallback
       │
       ▼
[Save Confirmation Broadcast]
       └─► Broadcast { type: 'save_status', status: 'saved', stateVersion, savedAt }
```

### Critical Persistence Insights
- **Asynchronous Debounce Window:** There is an active debounce window (1500ms–5000ms) between an in-memory Yjs change and the PostgreSQL write.
- **In-Memory Room State as Source of Truth:** While an editing session is active, the authoritative document state lives in `room.doc` in the Node.js process memory.
- **Dual-Format Persistence:** The system already stores both binary Yjs updates (`DocumentState.yjsState`) and ProseMirror JSON (`Page.content`).
- **Cascade Deletion:** When a `Page` is deleted, PostgreSQL cascades and cleans up `document_states` and `comments` automatically.

---

## 3. Recommended Snapshot Storage Design

### Storage Format Evaluation

| Storage Format | Pros | Cons | Recommendation |
| :--- | :--- | :--- | :---: |
| **Option A: Pure Yjs Binary (`yjsState BYTEA`)** | Exact, lossless CRDT reproduction. Directly reconstitutable into a `Y.Doc`. | Cannot be rendered in a lightweight preview without decoding binary through Yjs on the client. | Incomplete alone |
| **Option B: Pure TipTap JSON (`content JSONB`)** | Instantly renderable in preview drawer. Human-readable, queryable in PostgreSQL. | Re-inserting pure JSON into an existing CRDT Y.Doc requires re-parsing and creating a new transaction. | Incomplete alone |
| **Option C: Hybrid Storage (`yjsState BYTEA` + `content JSONB` + metadata)** | **Exact CRDT fidelity + instant frontend preview without binary decoding overhead.** | Minimal additional disk space (a few KB per snapshot in PostgreSQL). | **Recommended** |

### Snapshot Strategy
1. **Hybrid Record:** Each snapshot stores:
   - `yjsState` (`BYTEA`): Full binary CRDT update snapshot (`Buffer.from(Y.encodeStateAsUpdate(doc))`).
   - `content` (`JSONB`): TipTap ProseMirror JSON snapshot for instant preview rendering in the UI without Yjs initialization.
   - `label` (`String?`): Optional user-defined version name (e.g., "Draft 1.0", "Before meeting review").
   - `description` (`String?`): Optional notes explaining edits.
   - `wordCount` (`Int?`) and `characterCount` (`Int?`): Fast summary statistics.
   - `isAutomatic` (`Boolean`): Flag indicating whether the snapshot was manually created by a user or automatically created as a pre-restore safety recovery snapshot.
2. **Avoiding Inconsistent Snapshots During Active Collaboration:**
   - When creating a snapshot, if there is a pending debounced save in `pendingSaves`, we must flush it (`flushSave(pageId, doc)`) or capture from the authoritative `room.doc` if in the server process, OR read the current `DocumentState` and `Page.content` from PostgreSQL after ensuring persistence is committed.

---

## 4. Proposed Prisma Model

In accordance with `01_ARCHITECTURE.md` (lines 170–171: `VersionSnapshot: id, pageId, createdById, label nullable, snapshotBytes or serialized state, createdAt`), we propose the following Prisma model:

```prisma
model VersionSnapshot {
  id           String   @id @default(cuid())
  pageId       String
  page         Page     @relation(fields: [pageId], references: [id], onDelete: Cascade)
  createdById  String
  createdBy    User     @relation(fields: [createdById], references: [id], onDelete: Cascade)
  label        String?
  description  String?
  yjsState     Bytes    // Full binary CRDT snapshot for lossless restore
  content      Json?    // ProseMirror TipTap JSON for instant lightweight preview
  wordCount    Int?     @default(0)
  isAutomatic  Boolean  @default(false) // Distinguishes manual vs pre-restore recovery snapshots
  createdAt    DateTime @default(now())

  @@index([pageId])
  @@index([createdById])
  @@index([pageId, createdAt(sort: Desc)])
  @@map("version_snapshots")
}
```

### Relations to Add:
- On `Page`: `versionSnapshots VersionSnapshot[]`
- On `User`: `createdSnapshots VersionSnapshot[]`

### Constraints & Indexes:
- `onDelete: Cascade` on `page` ensures version snapshots are cleanly deleted when a page is removed.
- `onDelete: Cascade` on `createdBy` ensures user deletion does not leave dangling records.
- Composite index `@@index([pageId, createdAt(sort: Desc)])` guarantees fast chronological ordering and efficient pagination.

---

## 5. Proposed API Endpoints

All endpoints will be placed under the existing workspace and page hierarchy to inherit IDOR protection:

### 1. `GET /api/workspaces/[workspaceId]/pages/[pageId]/snapshots`
- **Purpose:** Lists all historical snapshots for the document ordered by `createdAt DESC`.
- **Query Parameters:** `?limit=30&cursor=...` (optional pagination).
- **Access:** Allowed for all authorized workspace members (`OWNER`, `EDITOR`, `COMMENTER`, `VIEWER`).
- **Response:**
  ```json
  {
    "snapshots": [
      {
        "id": "cmw...",
        "pageId": "cmw...",
        "label": "Sprint 3 Final Specs",
        "description": null,
        "isAutomatic": false,
        "wordCount": 420,
        "createdAt": "2026-11-07T14:30:00.000Z",
        "createdBy": {
          "id": "usr...",
          "name": "Alice Engineer",
          "email": "alice@workspace.dev"
        }
      }
    ]
  }
  ```

### 2. `POST /api/workspaces/[workspaceId]/pages/[pageId]/snapshots`
- **Purpose:** Creates a new named or timestamped snapshot of the current document state.
- **Access:** Restricted to `OWNER` and `EDITOR`. (`COMMENTER` and `VIEWER` receive `403 Forbidden`).
- **Request Body:**
  ```json
  {
    "label": "Sprint 3 Final Specs",
    "description": "Optional notes"
  }
  ```
- **Validation:** Zod schema enforcing string length limits (`label` max 100 chars, `description` max 500 chars).

### 3. `GET /api/workspaces/[workspaceId]/pages/[pageId]/snapshots/[snapshotId]`
- **Purpose:** Retrieves full snapshot details including `content` JSON for preview in the UI drawer.
- **Access:** Allowed for all authorized workspace members.

### 4. `POST /api/workspaces/[workspaceId]/pages/[pageId]/snapshots/[snapshotId]/restore`
- **Purpose:** Restores the document to the historical snapshot after creating an automatic recovery snapshot.
- **Access:** Restricted to `OWNER` and `EDITOR`.
- **Response:**
  ```json
  {
    "message": "Document restored successfully",
    "restoredSnapshotId": "cmw...",
    "recoverySnapshotId": "cmw..."
  }
  ```

---

## 6. Restore Workflow & Concurrency Strategy

The blueprints emphasize a critical safety rule:
> *"Restoration must create a new current state or recovery snapshot before replacing the visible state. Do not silently destroy the current version."* (`02_UI_DESIGN_WORKFLOW.md:93-95`)

### Concurrency & Restoration Execution Strategy

When restoring an older version, two challenges arise:
1. Preventing silent data loss of current uncommitted or recent edits.
2. Synchronizing active collaborative clients currently connected to the room via WebSocket.

#### Recommended 4-Step Safe Restore Workflow:

```
[User Clicks "Restore Version" + Confirms in Modal]
                     │
                     ▼
  Step 1: Automatic Recovery Snapshot Creation
  - Capture current DocumentState + Page.content
  - Persist new VersionSnapshot with label:
    "Recovery snapshot before restoring: <Old Version Label>"
  - isAutomatic = true
                     │
                     ▼
  Step 2: Content Replacement in CRDT
  - Fetch target snapshot (content JSON & yjsState)
  - Execute a single atomic replacement transaction in Y.Doc:
      doc.transact(() => {
        const fragment = doc.getXmlFragment('default');
        fragment.delete(0, fragment.length);
        prosemirrorJSONToYXmlFragment(schema, snapshot.content, fragment);
      }, 'restore');
                     │
                     ▼
  Step 3: Real-Time CRDT Broadcast to Connected Peers
  - Yjs automatically generates delete + insert update frames
  - Broadcasts update to all connected WebSocket clients in real-time
  - Clients' TipTap editor surfaces instantly update without socket disconnect
                     │
                     ▼
  Step 4: Immediate Persistence Flush
  - Call flushSave(pageId, doc)
  - Updates DocumentState.yjsState and Page.content in PostgreSQL
  - Broadcasts { type: 'save_status', status: 'saved' }
```

### Why CRDT-Level Content Replacement is Superior to Raw DB Overwrite:
- If we only overwrote PostgreSQL `DocumentState` directly in the database, in-memory `Y.Doc` instances across currently connected peers would remain on the newer version.
- Performing the restore as an atomic Yjs transaction creates a legitimate CRDT deletion-and-insertion update. Every collaborator's screen updates in real time, collaborative undo/redo preserves the action, and no client disconnections or race conditions occur.

---

## 7. Role-Based Permissions Matrix

| Capability | OWNER | EDITOR | COMMENTER | VIEWER |
| :--- | :---: | :---: | :---: | :---: |
| **List Version Snapshots** | Yes | Yes | Yes | Yes |
| **Inspect Snapshot Metadata & Timestamps** | Yes | Yes | Yes | Yes |
| **Preview Snapshot Content (Read-Only)** | Yes | Yes | Yes | Yes |
| **Create Manual Named Snapshot** | Yes | Yes | No (403) | No (403) |
| **Restore Older Version** | Yes | Yes | No (403) | No (403) |
| **Automatic Recovery Snapshot Trigger** | System | System | N/A | N/A |

---

## 8. UI Component Plan

In accordance with `02_UI_DESIGN_WORKFLOW.md:180-182`:
```
src/components/
  history/
    VersionHistoryPanel.tsx
    SnapshotItem.tsx
    RestoreConfirmationDialog.tsx
```

### Component Details
1. **Entry Point in [`RichTextEditor.tsx`](file:///d:/NT%20PROJECTS/Real-Time%20Collaborative%20Workspace/src/components/editor/RichTextEditor.tsx):**
   - Add a "History" toggle button in the header action bar next to the "Comments" button:
     `<button onClick={() => setIsHistoryOpen(prev => !prev)}><History className="w-3.5 h-3.5" /> History</button>`
   - Right-side drawer: Toggle between `CommentPanel` and `VersionHistoryPanel` (or tabs).
2. **`VersionHistoryPanel.tsx`:**
   - **Header:** Title "Version History", close button (`X`), and "+ Name this version" button (visible only to `OWNER` and `EDITOR`).
   - **Snapshots List:** Chronological list using `SnapshotItem`.
   - **States Handled:**
     - Loading skeleton while fetching history.
     - Empty state ("No version snapshots saved yet").
     - Error state with retry button.
     - Current version indicator (top item representing live state).
3. **`SnapshotItem.tsx`:**
   - Snapshot label or formatted timestamp (e.g., "Nov 7, 2026, 2:45 PM").
   - Author avatar/initials and author name.
   - Badge for "Automatic Recovery" vs "Manual".
   - Word count / summary.
   - Click to select and preview.
   - "Restore" button (restricted to `OWNER` and `EDITOR`).
4. **`RestoreConfirmationDialog.tsx`:**
   - Modal warning: *"Restoring this version will replace the current document content. A recovery snapshot of your current version will be saved automatically so you can always revert back."*
   - Actions: "Cancel" and "Restore Version".

---

## 9. Risks and Edge Cases

1. **Active Typing During Restore:**
   - *Risk:* A collaborator is typing while another user restores an older snapshot.
   - *Mitigation:* The CRDT transaction clears and replaces the fragment content atomically. Typing that occurs concurrently will merge gracefully via Yjs CRDT semantics, but a recovery snapshot is already safely locked in PostgreSQL.
2. **Storage Growth from Large BYTEA / JSON Blobs:**
   - *Risk:* Frequent snapshot creation increases PostgreSQL storage.
   - *Mitigation:* Snapshots are created on explicit user action ("Name this version") or pre-restore safety checkpoints. Average document size is 5–50 KB, so even 1,000 snapshots consume under 20 MB.
3. **Empty / Fresh Document Snapshots:**
   - *Risk:* Creating a snapshot of an empty page without text.
   - *Mitigation:* Validation checks: handle empty fragments gracefully without throwing schema errors.
4. **Cross-Workspace IDOR Vulnerabilities:**
   - *Risk:* Accessing a snapshot belonging to a page in a different workspace.
   - *Mitigation:* Strict validation in every route: check workspace membership, verify `page.workspaceId === workspaceId`, and verify `snapshot.pageId === pageId`.

---

## 10. Implementation Sequence for Steps 2–6

- **Phase 10 — Step 2: Database Schema & Snapshot Data Layer**
  - Add `VersionSnapshot` model and relations to `prisma/schema.prisma`.
  - Create and run migration.
  - Implement Zod validation schemas (`src/lib/validations/snapshot.ts`).
- **Phase 10 — Step 3: Snapshot Creation & Listing APIs**
  - Implement `GET /api/workspaces/[workspaceId]/pages/[pageId]/snapshots`.
  - Implement `POST /api/workspaces/[workspaceId]/pages/[pageId]/snapshots`.
  - Add RBAC authorization and IDOR protections.
- **Phase 10 — Step 4: Safe Restore API & Synchronization Strategy**
  - Implement `POST /api/workspaces/[workspaceId]/pages/[pageId]/snapshots/[snapshotId]/restore`.
  - Implement automatic pre-restore recovery snapshot creation.
  - Integrate with persistence and CRDT update mechanisms.
- **Phase 10 — Step 5: Frontend Version History UI**
  - Build `VersionHistoryPanel.tsx`, `SnapshotItem.tsx`, and `RestoreConfirmationDialog.tsx`.
  - Add History button and drawer in `RichTextEditor.tsx`.
  - Implement preview mode and role-based action gating.
- **Phase 10 — Step 6: Automated Testing & Verification**
  - Build comprehensive test suite `tests/phase10_version_history_verify.mjs`.
  - Verify all 213+ existing tests pass without regressions.
  - Run Prisma, TypeScript, ESLint, and production build checks.

---

## 11. Files Likely to be Modified

1. `prisma/schema.prisma` (Add `VersionSnapshot` model & relations)
2. `prisma/migrations/*` (New migration for version snapshots)
3. `src/lib/validations/snapshot.ts` (New validation schema file)
4. `src/app/api/workspaces/[workspaceId]/pages/[pageId]/snapshots/route.ts` (New API route)
5. `src/app/api/workspaces/[workspaceId]/pages/[pageId]/snapshots/[snapshotId]/route.ts` (New API route)
6. `src/app/api/workspaces/[workspaceId]/pages/[pageId]/snapshots/[snapshotId]/restore/route.ts` (New API route)
7. `src/components/history/VersionHistoryPanel.tsx` (New component file)
8. `src/components/history/SnapshotItem.tsx` (New component file)
9. `src/components/history/RestoreConfirmationDialog.tsx` (New component file)
10. `src/components/editor/RichTextEditor.tsx` (Add History toggle button and drawer integration)
11. `tests/phase10_version_history_verify.mjs` (New automated test suite)

---

## 12. Explicit Confirmation of Read-Only Inspection

**CONFIRMED:**
- This inspection was performed strictly in **READ-ONLY** mode.
- No database schemas were altered.
- No migrations were created.
- No dependencies were installed.
- No existing source code or test files were modified.
- The four canonical blueprint documents (`01_ARCHITECTURE.md`, `02_UI_DESIGN_WORKFLOW.md`, `03_DEVELOPMENT_PHASES.md`, `04_PRD.md`) remain 100% untouched.
- `git status` remains completely clean.
- All Phase 1–9 functionality and database records remain intact.

---
*Inspection complete. Standing by for user review and approval before proceeding with Phase 10 Step 2.*

