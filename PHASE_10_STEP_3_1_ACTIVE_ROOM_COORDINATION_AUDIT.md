# Phase 10 — Step 3.1: Active Room Coordination Architecture Audit

**Project:** Real-Time Collaborative Workspace (Notion/Figma-Style Editor)  
**Audit Target:** Phase 10 Step 3 — Snapshot Service & Active Room Coordination  
**Execution Date:** November 7, 2026  
**Audit Type:** Strict READ-ONLY Architectural & Process-Boundary Audit  
**Author:** Antigravity Pairing Assistant  

---

## 1. Executive Summary & Critical Finding

### Critical Question:
> *Can the Snapshot Service running inside the Next.js API server genuinely access the active `Y.Doc` instances owned by the dedicated `collab-server.mjs` WebSocket server?*

### Definitive Answer:
**NO.** Under the current production and development runtime architecture, the Snapshot Service executing within Next.js **cannot** access the active `Y.Doc` instances or the pending persistence queue owned by the dedicated WebSocket server.

### Root Cause:
1. **Physical OS Process Isolation:** The Next.js application (App Router API routes) runs in one Node.js operating system process (typically port `3000`), while the collaboration server (`src/server/collab-server.mjs`) runs in a completely separate standalone Node.js process (port `1234`, invoked via `npm run collab`).
2. **Process-Local Scope of `globalThis`:** `globalThis.__collabRooms` is registered on the global object of the `collab-server.mjs` process only. In Node.js, `globalThis` is strictly isolated within the V8 isolate / process memory space. In the Next.js process, `globalThis.__collabRooms` is `undefined`.
3. **Process-Local Scope of `pendingSaves`:** The persistence debounce queue (`pendingSaves = new Map()`) in `src/server/collab-persistence.mjs` is also an in-memory module variable. Next.js imports its own instance of `collab-persistence.mjs` in its own heap, where `pendingSaves` is perpetually empty.
4. **Silent Database Fallback:** When a snapshot request arrives at Next.js, `getActiveRoomDoc(pageId)` returns `null` and `hasPendingSave(pageId)` returns `false`. The service silently executes the fallback branch, reading directly from the PostgreSQL `document_states` table via `loadDocumentState(pageId)`.
5. **Data Stale Window:** Any edits received by the WebSocket server that are currently held in memory or sitting in the 1500ms debounce timer (or up to 5000ms max wait) are **completely omitted** from the snapshot.

---

## 2. Actual Process Architecture

```
+--------------------------------------------------------------------------------------------------+
|                                    OPERATING SYSTEM HOST                                         |
|                                                                                                  |
|   +---------------------------------------+      +-------------------------------------------+   |
|   |   PROCESS 1: Next.js App Router       |      |   PROCESS 2: Dedicated Collab Server      |   |
|   |   PID: e.g. 14220                     |      |   PID: e.g. 18560                         |   |
|   |   Command: `npm run dev` / `start`    |      |   Command: `node collab-server.mjs`       |   |
|   |   Port: 3000 (HTTP)                   |      |   Port: 1234 (WS + HTTP)                  |   |
|   |                                       |      |                                           |   |
|   |   V8 Virtual Memory Heap:             |      |   V8 Virtual Memory Heap:                 |   |
|   |   - globalThis.__collabRooms: UNDEFINED|     |   - globalThis.__collabRooms: Map(...)   |   |
|   |   - collab-persistence.mjs:           |      |   - collab-persistence.mjs:               |   |
|   |       pendingSaves: Map(0)            |      |       pendingSaves: Map(1) [ACTIVE TIMER] |   |
|   |       writeQueues:  Map(0)            |      |       writeQueues:  Map(0)                |   |
|   |   - version-snapshot-service.mjs      |      |   - rooms: Map<pageId, CollabRoom>        |   |
|   |   - API: /api/.../versions            |      |       - room.doc: Y.Doc (LATEST EDITS)    |   |
|   |                                       |      |       - room.awareness                    |   |
|   |                                       |      |       - room.clients                      |   |
|   +-------------------+-------------------+      +---------------------+---------------------+   |
|                       |                                                |                         |
|                       | (No IPC / No Shared Memory)                    |                         |
|                       |                                                |                         |
|                       v                                                v                         |
|   +------------------------------------------------------------------------------------------+   |
|   |                                 PostgreSQL Database 16                                   |   |
|   |                              Port 5432 (Docker Container)                                |   |
|   |                                                                                          |   |
|   |   Tables:                                                                                |   |
|   |   - document_states (Updated ONLY when Process 2 flushes after 1500ms debounce)          |   |
|   |   - version_snapshots (Written by Process 1 from stale document_states)                   |   |
|   +------------------------------------------------------------------------------------------+   |
+--------------------------------------------------------------------------------------------------+
```

### Process Isolation Breakdown:

| Attribute | Next.js Server Process | Dedicated Collaboration Server |
|---|---|---|
| **Entrypoint** | `next dev` or `next start` | `node src/server/collab-server.mjs` (`npm run collab`) |
| **Port & Protocol** | HTTP on `localhost:3000` | WebSocket + HTTP on `localhost:1234` |
| **Virtual Address Space** | Isolated OS Process Memory | Isolated OS Process Memory |
| **`globalThis.__collabRooms`** | `undefined` | `Map<pageId, CollabRoom>` |
| **`pendingSaves` Map** | Empty `Map(0)` | Holds active debounce timers & unwritten `Y.Doc` |
| **Authoritative Document State** | Relies on PostgreSQL `document_states` | In-memory `room.doc` (real-time CRDT) |
| **Inter-Process Communication** | **NONE currently implemented** | **NONE currently implemented** |

---

## 3. Detailed Code Inspection & Execution Trace

### 3.1 Trace of `globalThis.__collabRooms` Initialization and Usage

1. **In `src/server/collab-server.mjs` (Lines 172–174):**
   ```javascript
   // In-memory room storage: Map<pageId, CollabRoom>
   const rooms = new Map();
   globalThis.__collabRooms = rooms;
   ```
   This assignment executes **only** when `createCollabServer()` runs inside the standalone collaboration server process (`Process 2`).

2. **In `src/server/version-snapshot-service.mjs` (Lines 57–65):**
   ```javascript
   export function getActiveRoomDoc(pageId) {
     if (globalThis.__collabRooms && globalThis.__collabRooms.has(pageId)) {
       const room = globalThis.__collabRooms.get(pageId);
       if (room && !room.isDestroyed && room.doc) {
         return room.doc;
       }
     }
     return null;
   }
   ```
   When invoked via Next.js route handlers (`src/app/api/workspaces/[workspaceId]/pages/[pageId]/versions/route.ts`), this runs inside `Process 1`. In `Process 1`, `globalThis.__collabRooms` is evaluated as `undefined`. Consequently, `getActiveRoomDoc(pageId)` returns `null` on line 64 every time.

3. **Why Unit Test 8 Passed in `tests/phase10_snapshot_service_verify.mjs`:**
   In `tests/phase10_snapshot_service_verify.mjs` (lines 306–313):
   ```javascript
   // Mock active room in globalThis.__collabRooms
   if (!globalThis.__collabRooms) {
     globalThis.__collabRooms = new Map();
   }
   globalThis.__collabRooms.set(testPageId2, {
     doc: activeDoc,
     isDestroyed: false,
   });
   ```
   The unit test ran in a **single Node.js process**, directly populating `globalThis.__collabRooms` inside that same runner process before calling `createVersionSnapshot`. While this proved the *internal conditional logic* of the function, it masked the physical multi-process boundary present in real system execution.

---

### 3.2 Trace of Persistence Ownership and Flush Coordination

1. **In `src/server/collab-persistence.mjs` (Lines 103–105):**
   ```javascript
   // Internal State: Per-Document Sequential Write Queues & Debounce Schedules
   const writeQueues = new Map(); // pageId -> Promise<any>
   const pendingSaves = new Map(); // pageId -> SaveTask
   ```
   `pendingSaves` is a module-scoped `Map` in `collab-persistence.mjs`. Because Next.js and the collaboration server are separate processes, Node.js evaluates this module independently in each process.

2. **In `src/server/collab-server.mjs` (Lines 262–270):**
   When an active editor types in the browser, WebSocket updates are applied to `room.doc`:
   ```javascript
   room.hasUnsavedChanges = true;
   scheduleSave(pageId, doc); // Registers a 1500ms debounce timer in Process 2's pendingSaves
   ```

3. **In `src/server/version-snapshot-service.mjs` (Lines 106–113):**
   When the snapshot request arrives at Next.js:
   ```javascript
   // No active in-memory room: if a background persistence save is pending, await it
   if (hasPendingSave(pageId)) {
     try {
       const dummyDoc = new Y.Doc();
       await flushSave(pageId, dummyDoc, { prisma });
       dummyDoc.destroy();
     } catch {}
   }
   ```
   Because `hasPendingSave(pageId)` checks `pendingSaves` in **Process 1** (Next.js), it always returns `false`.
   The actual active debounce timer in **Process 2** is neither checked nor cancelled, and `Process 2` is never asked to flush!

---

### 3.3 End-to-End Execution Trace of a Snapshot API Request

When an editor clicks "Create Version Snapshot" while actively working:

```
Timeline:
  T = 0ms    : User types "Paragraph 3: Critical specifications."
               Browser sends Yjs sync update via WebSocket to ws://localhost:1234 (Process 2).
  T = 20ms   : Process 2 receives update, modifies in-memory room.doc.
               Process 2 calls scheduleSave(pageId, room.doc).
               pendingSaves registers debounce timer to fire at T = 1520ms.
  T = 100ms  : User clicks "Save Version Snapshot" in the UI.
               Browser sends POST /api/workspaces/.../versions to http://localhost:3000 (Process 1).
  T = 110ms  : Process 1 (Next.js) receives HTTP request.
               - Verifies user auth & permissions (PASS).
               - Calls createVersionSnapshot(pageId).
               - Checks getActiveRoomDoc(pageId) -> globalThis.__collabRooms is undefined -> returns null.
               - Checks hasPendingSave(pageId) -> Process 1's pendingSaves is empty -> returns false.
               - Instantiates temporary Y.Doc: tempDoc = new Y.Doc().
               - Calls loadDocumentState(pageId, tempDoc).
               - Queries PostgreSQL document_states table.
  T = 125ms  : PostgreSQL returns document state from the PREVIOUS flush (T < 0ms).
               tempDoc is hydrated WITHOUT "Paragraph 3: Critical specifications."
  T = 135ms  : Process 1 encodes tempDoc:
               - snapshotBuffer = Y.encodeStateAsUpdate(tempDoc) [STALE]
               - contentJson = yXmlFragmentToProsemirrorJSON(...) [STALE]
               - wordCount = calculateWordCount(contentJson) [STALE]
  T = 145ms  : Process 1 creates row in version_snapshots with the STALE data.
               Returns HTTP 201 Created to browser.
  T = 1520ms : Process 2's debounce timer fires.
               Process 2 executes saveDocumentState(pageId, room.doc).
               PostgreSQL document_states is updated with "Paragraph 3".
               
Result: The version snapshot permanently misses "Paragraph 3", even though the snapshot record 
has createdAt = T + 145ms (newer than the previous document_states row).
```

---

## 4. Data Consistency Risks & Race Conditions

| # | Risk / Failure Mode | Severity | Impact Description |
|---|---|---|---|
| **1** | **Stale Snapshot Capture** | **HIGH** | Any manual snapshot taken while users are collaborating or within 1.5 seconds of the last edit will drop recent keystrokes. |
| **2** | **Catastrophic Pre-Restore Data Loss in Step 4** | **CRITICAL** | In Phase 10 Step 4, restoring a version requires taking an automatic recovery snapshot (`createRecoverySnapshot`) first. Because the recovery snapshot reads stale PostgreSQL data, the unpersisted current draft in `room.doc` will be permanently lost when the restore overwrites the active room. |
| **3** | **Brand-New Page Snapshot Emptiness** | **HIGH** | If an editor creates a brand-new page and types content without waiting 1.5s before taking a snapshot, PostgreSQL has zero `DocumentState` records. The snapshot will be recorded as completely empty. |
| **4** | **Uncoordinated Concurrent Writes** | **MEDIUM** | If Next.js attempted to write to `document_states` while Process 2 was writing, the in-memory write locks (`writeQueues = new Map()`) in `collab-persistence.mjs` are process-local, meaning PostgreSQL row-level concurrency could lead to version counter desynchronization. |

---

## 5. Recommended Zero-Cost Solution

To resolve this issue cleanly, deterministically, and with **₹0 budget and zero new external infrastructure**, we should leverage the fact that **`collab-server.mjs` already runs an HTTP server** on port `1234`.

### Recommended Pattern: Internal Loopback Flush RPC

`collab-server.mjs` already uses Node's native `http.createServer()` (lines 343–361) to serve `/health` and handle WebSocket upgrade handshakes. We can expose an internal RPC endpoint on this existing HTTP server.

```
+-----------------------------+                           +-----------------------------+
|    Next.js API Server       |                           |  Dedicated Collab Server    |
|       (Port 3000)           |                           |       (Port 1234)           |
+--------------+--------------+                           +--------------+--------------+
               |                                                         |
               | 1. POST http://127.0.0.1:1234/internal/rooms/:pageId/flush
               |    Headers: { Authorization: "Bearer <AUTH_SECRET>" }   |
               |-------------------------------------------------------->|
               |                                                         | 2. Check rooms.get(pageId)
               |                                                         |    If active & unsaved:
               |                                                         |    await flushSave(pageId, room.doc)
               |                                                         | 3. Return 200 OK
               |                                                         |    { active: true, flushed: true }
               | 4. Receives 200 OK                                      |
               |<--------------------------------------------------------|
               |
               | 5. loadDocumentState(pageId)
               |    Reads PostgreSQL document_states
               |    (Guaranteed 100% fresh and aligned!)
               |
               | 6. Creates VersionSnapshot in PostgreSQL
               v
```

### Advantages of this approach:
1. **Zero External Infrastructure:** No Redis, no RabbitMQ, no shared memory daemon, no OS-specific named pipes. Uses native Node.js HTTP and `fetch`.
2. **Deterministic Consistency:** The active room doc is flushed to PostgreSQL *before* Next.js queries `document_states`. Both the CRDT binary state and the TipTap preview AST are guaranteed to reflect the exact latest keystrokes.
3. **Graceful Fallback:** If `collab-server.mjs` is down or the room is not active (returns 404 or connection refused), Next.js simply falls back to reading PostgreSQL as it does now.
4. **Security & Isolation:** The endpoint binds strictly to loopback (`127.0.0.1`) and validates the existing `AUTH_SECRET` bearer token, preventing external access.
5. **Enables Safe Restoration (Step 4):** In Step 4, when Next.js wants to restore an old version, it can call `POST http://127.0.0.1:1234/internal/rooms/:pageId/restore`, enabling Process 2 to load the restored state into `room.doc` and immediately broadcast `MESSAGE_SYNC` to all connected browser clients via WebSocket!

---

## 6. Audit Verdict & Approval Status

### Is Step 3 Safe to Approve As-Is?

| Component | Status | Evaluation |
|---|---|---|
| **Database Schema & Migration** | **APPROVED** | `VersionSnapshot` model and migration `20261107102440_add_version_snapshots` are complete, robust, and correctly indexed. |
| **Zod Validations** | **APPROVED** | `createVersionSnapshotSchema` enforces correct boundaries for `label` and `description`. |
| **REST API Routes & Role Authorization** | **APPROVED** | Role checks (`OWNER` & `EDITOR` only for POST; all roles for GET), IDOR cross-workspace/cross-page protection, and payload hygiene are 100% compliant. |
| **Unit Persistence & AST Parsing** | **APPROVED** | Dual storage, word count calculation, and binary Yjs round-trip logic work as intended. |
| **Cross-Process Room Coordination** | **BLOCKED** | Active in-memory document state cannot be captured across the process boundary using `globalThis.__collabRooms`. |

### Final Recommendation:
- **Do NOT proceed to Phase 10 Step 4 (Document Restore) until cross-process coordination is bridged.**
- Proceed with **Phase 10 — Step 3.2: Cross-Process Room Coordination Remediation** (implementing the internal HTTP flush/sync bridge between Next.js and `collab-server.mjs`) before starting Step 4.
- Because Step 4 fundamentally relies on active room coordination to:
  1. Capture a non-destructive recovery snapshot of active in-memory edits before restore.
  2. Overwrite the in-memory `room.doc` in `collab-server.mjs`.
  3. Broadcast the restored Yjs update live to connected clients over WebSockets.
  Solving this coordination bridge is the essential prerequisite for Step 4.

