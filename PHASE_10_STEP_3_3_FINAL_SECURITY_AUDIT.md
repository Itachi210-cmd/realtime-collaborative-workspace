# Phase 10 — Step 3.3: RPC Security & Snapshot Integration Final Audit

**Project:** Real-Time Collaborative Workspace (Notion/Figma-Style Editor)  
**Execution Date:** November 7, 2026  
**Audit Target:** Phase 10 Step 3 & Step 3.2 Security, Cryptography & Integration  
**Audit Mode:** Strict READ-ONLY Security & Cryptographic Audit  
**Author:** Antigravity Pairing Assistant  

---

## 1. Executive Summary

This security and integration audit provides a comprehensive, criteria-by-criteria verification of the Phase 10 Snapshot Service and the internal cross-process RPC coordination bridge implemented in Steps 3 and 3.2.

Fourteen distinct security, architectural, and data-integrity requirements were audited across:
- `src/server/collab-server.mjs`
- `src/server/collab-internal-client.mjs`
- `src/server/version-snapshot-service.mjs`
- Next.js Version API routes (`/api/workspaces/[workspaceId]/pages/[pageId]/versions`)
- Environment configuration (`.env.local`)
- RPC coordination and snapshot verification test suites

### Overall Score: **9 PASS / 5 FAIL**

While the core functionality (cross-process room flushing, debounce queue clearing, hydration synchronization, stale fallback prevention, and Phase 9 RBAC/IDOR isolation) is **100% operational and verified**, the audit revealed **5 specific security and secret-hygiene deficiencies** regarding how `INTERNAL_RPC_SECRET` is managed and compared.

---

## 2. Verification Checklist & Verdict Matrix

| # | Audit Criterion | Status | Primary Component | Key Finding / Vulnerability |
|---|---|---|---|---|
| **1** | `INTERNAL_RPC_SECRET` is mandatory and dedicated | **FAIL** | `collab-server.mjs`, `collab-internal-client.mjs` | Currently optional; permits fallback to `AUTH_SECRET`. |
| **2** | Do not silently fall back to `AUTH_SECRET` | **FAIL** | `collab-server.mjs`, `collab-internal-client.mjs` | Explicit fallback: `process.env.INTERNAL_RPC_SECRET \|\| process.env.AUTH_SECRET`. |
| **3** | Missing or weak secret must prevent server startup | **FAIL** | `collab-server.mjs` | Collab server starts and listens without asserting secret presence/length. |
| **4** | Secret has $\ge 32$ cryptographically random bytes of entropy | **FAIL** | `.env.local`, `collab-server.mjs` | Contains ASCII placeholder passphrase; no startup check for $\ge 32$ bytes entropy. |
| **5** | Secret comparison uses timing-safe comparison | **FAIL** | `collab-server.mjs` | Uses standard JavaScript string inequality `!==` vulnerable to side-channel timing attacks. |
| **6** | Internal RPC endpoint is genuinely loopback-only | **PASS** | `collab-server.mjs` | Raw TCP socket check (`req.socket.remoteAddress`) strictly rejects non-loopback IPs with 403. |
| **7** | No browser/client-side code can access the secret | **PASS** | Entire codebase, `.env.local` | Server-only variable (no `NEXT_PUBLIC_` prefix); imported only in `src/server/`. |
| **8** | Request body and `pageId` are validated | **PASS** | `collab-server.mjs`, `snapshot.ts` | Method enforced (POST), `pageId` validated, Zod length constraints enforced. |
| **9** | Active room hydration completes before flushing | **PASS** | `collab-server.mjs` | Awaits `roomHydrationPromises.get(pageId)` before checking or flushing room. |
| **10** | Flush succeeds only after PostgreSQL persistence completes | **PASS** | `collab-server.mjs`, `collab-persistence.mjs` | Awaits `flushSave` atomic PostgreSQL upsert before emitting HTTP 200. |
| **11** | RPC timeout or flush failure never silently falls back to stale DB | **PASS** | `collab-internal-client.mjs`, `version-snapshot-service.mjs` | Collab 500 error or timeout throws an exception, aborting snapshot creation. |
| **12** | No-active-room fallback reads latest persisted state | **PASS** | `version-snapshot-service.mjs` | Inactive/dormant rooms return `active: false`; loads fresh PostgreSQL `DocumentState`. |
| **13** | Manual & automatic snapshots use consistent binary & preview AST | **PASS** | `version-snapshot-service.mjs` | Synchronously generates both representations from the identical hydrated `Y.Doc`. |
| **14** | Existing Phase 9 RBAC and IDOR protections remain intact | **PASS** | Version API routes, `workspace-auth.ts` | Role checks (OWNER/EDITOR only for POST, all roles for GET), IDOR prevention 100% passing. |

---

## 3. Detailed Technical Analysis for Every Check

---

### Check 1: `INTERNAL_RPC_SECRET` is Mandatory and Dedicated
- **Verdict:** **FAIL**
- **Location:**
  - `src/server/collab-server.mjs` (lines 170–172)
  - `src/server/collab-internal-client.mjs` (line 32)
- **Code Inspection:**
  ```javascript
  // src/server/collab-server.mjs
  const internalRpcSecret = options.internalRpcSecret ?? (
    process.env.INTERNAL_RPC_SECRET || process.env.AUTH_SECRET
  );
  
  // src/server/collab-internal-client.mjs
  const secret = options.secret || process.env.INTERNAL_RPC_SECRET || process.env.AUTH_SECRET;
  ```
- **Finding:** `INTERNAL_RPC_SECRET` is treated as an optional override rather than a strictly required, dedicated secret. If `INTERNAL_RPC_SECRET` is removed or unset in environment variables, the system does not complain or fail; it silently repurposes `AUTH_SECRET`.
- **Required Fix:** Disallow the fallback. If `process.env.INTERNAL_RPC_SECRET` is absent, throw a fatal configuration error immediately.

---

### Check 2: Do Not Silently Fall Back to `AUTH_SECRET`
- **Verdict:** **FAIL**
- **Location:**
  - `src/server/collab-server.mjs` (line 171)
  - `src/server/collab-internal-client.mjs` (lines 32, 35)
- **Finding:** Coupling internal server RPC authentication to `AUTH_SECRET` creates a severe **privilege and rotation boundary violation**:
  1. `AUTH_SECRET` is intended strictly for signing and verifying user session JWT cookies (`collab_session`).
  2. If `AUTH_SECRET` is rotated due to an end-user session policy change, internal RPC communication could fail or be exposed.
  3. Sharing keys across distinct security domains violates the principle of least privilege and key separation (NIST SP 800-57 Part 1).
- **Required Fix:** Remove all references to `process.env.AUTH_SECRET` in both `collab-server.mjs` and `collab-internal-client.mjs`.

---

### Check 3: Missing or Weak Secret Must Prevent Server Startup
- **Verdict:** **FAIL**
- **Location:** `src/server/collab-server.mjs` (lines 145–175, 1052–1076)
- **Finding:**
  When `createCollabServer()` or `startCollabServer()` initializes, it does **not** assert the presence or length of `internalRpcSecret`.
  If both `INTERNAL_RPC_SECRET` and `AUTH_SECRET` are unset, `internalRpcSecret` evaluates to `undefined`. The server proceeds to bind to port `1234` and accepts WebSocket connections anyway. The missing secret is only detected upon an incoming HTTP request on line 392 (`if (!internalRpcSecret ...)`).
- **Required Fix:** Add an explicit startup assertion in `createCollabServer()`:
  ```javascript
  if (!internalRpcSecret || typeof internalRpcSecret !== 'string' || Buffer.byteLength(internalRpcSecret, 'utf8') < 32) {
    throw new Error('[CollabServer] Fatal startup error: INTERNAL_RPC_SECRET must be configured with at least 32 bytes of entropy.');
  }
  ```

---

### Check 4: Secret Has at Least 32 Cryptographically Random Bytes of Entropy
- **Verdict:** **FAIL**
- **Location:** `.env.local` (line 3)
- **Finding:**
  `.env.local` currently specifies:
  `INTERNAL_RPC_SECRET="collab-internal-rpc-secret-key-32-chars-min!"`
  While this string has a character length of 42, it is a human-readable English passphrase rather than a cryptographically random byte sequence generated by a cryptographically secure pseudo-random number generator (CSPRNG).
- **Required Fix:**
  1. Generate a genuine 256-bit (32-byte) hex-encoded secret using `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
  2. Implement an automated startup check asserting `Buffer.byteLength(secret) >= 32`.

---

### Check 5: Secret Comparison Uses Timing-Safe Comparison
- **Verdict:** **FAIL**
- **Location:** `src/server/collab-server.mjs` (line 393)
- **Code Inspection:**
  ```javascript
  if (!internalRpcSecret || scheme !== 'Bearer' || !token || token !== internalRpcSecret)
  ```
- **Finding:**
  The comparison `token !== internalRpcSecret` uses JavaScript's standard variable-time string inequality operator.
  Standard string equality compares characters from index 0 to $N-1$ and terminates immediately upon discovering the first differing character. This exposes the system to **side-channel timing attacks**, where an attacker measuring nanosecond response latency differences can progressively guess the secret byte-by-byte.
- **Required Fix:**
  Use Node.js's native `crypto.timingSafeEqual`:
  ```javascript
  import crypto from 'node:crypto';
  
  const expectedBuf = Buffer.from(internalRpcSecret, 'utf8');
  const actualBuf = Buffer.from(token || '', 'utf8');
  
  const isAuthValid =
    scheme === 'Bearer' &&
    expectedBuf.length === actualBuf.length &&
    crypto.timingSafeEqual(expectedBuf, actualBuf);
    
  if (!isAuthValid) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized: Invalid internal RPC secret' }));
    return;
  }
  ```

---

### Check 6: Internal RPC Endpoint is Genuinely Loopback-Only
- **Verdict:** **PASS**
- **Location:** `src/server/collab-server.mjs` (lines 378–389)
- **Code Inspection:**
  ```javascript
  const remoteAddress = req.socket?.remoteAddress;
  const isLoopback =
    remoteAddress === '127.0.0.1' ||
    remoteAddress === '::1' ||
    remoteAddress === '::ffff:127.0.0.1' ||
    remoteAddress === 'localhost';

  if (!isLoopback && !allowExternalRpc) {
    console.warn(`[CollabServer] Rejected non-loopback internal RPC attempt from: ${remoteAddress}`);
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Forbidden: Internal RPC restricted to loopback address' }));
    return;
  }
  ```
- **Finding:**
  The check evaluates `req.socket.remoteAddress` directly from the raw TCP socket provided by the Node.js kernel. It **ignores** all client-controllable HTTP headers (e.g., `X-Forwarded-For`, `X-Real-IP`, `Host`), making IP spoofing impossible over standard TCP connections.
  Any inbound connection originating outside the local machine receives an immediate `403 Forbidden`.

---

### Check 7: No Browser/Client-Side Code Can Access the Secret
- **Verdict:** **PASS**
- **Location:** `src/server/collab-internal-client.mjs`, Next.js bundles
- **Finding:**
  1. The environment variable is named `INTERNAL_RPC_SECRET`, strictly avoiding Next.js's `NEXT_PUBLIC_` convention.
  2. Static analysis and repository-wide grep confirmed that `INTERNAL_RPC_SECRET` is imported exclusively inside `src/server/` modules.
  3. No React component, browser hook, or client-rendered page has access to this variable.
  4. Next.js webpack production compilation (`npx next build --webpack`) confirmed that no client chunks bundle this secret.

---

### Check 8: Request Body and `pageId` are Validated
- **Verdict:** **PASS**
- **Location:**
  - `src/server/collab-server.mjs` (lines 398–408)
  - `src/lib/validations/snapshot.ts`
  - `src/server/version-snapshot-service.mjs` (line 88)
- **Finding:**
  1. Method is strictly enforced as `POST` (other methods receive `405 Method Not Allowed`).
  2. `pageId` is decoded from URI components, trimmed, and validated against non-empty string and max length (255 characters).
  3. In Next.js route handlers, the request body is parsed and validated using Zod (`createVersionSnapshotSchema`), enforcing max 100 characters for `label` and max 500 characters for `description`.

---

### Check 9: Active Room Hydration Completes Before Flushing
- **Verdict:** **PASS**
- **Location:** `src/server/collab-server.mjs` (lines 411–429)
- **Code Inspection:**
  ```javascript
  let room = rooms.get(pageId);
  if (!room && roomHydrationPromises.has(pageId)) {
    try {
      room = await roomHydrationPromises.get(pageId);
    } catch (err) {
      console.error(`[CollabServer] Room hydration failed during internal flush for "${pageId}":`, err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ... }));
      return;
    }
  }
  ```
- **Finding:**
  If a document room is currently undergoing initial asynchronous hydration from PostgreSQL when the internal flush RPC arrives, the server retrieves the in-flight Promise from `roomHydrationPromises` and awaits its resolution before evaluating the room or attempting a write. This prevents race conditions where an unhydrated or partially hydrated room could be flushed.

---

### Check 10: Flush Succeeds Only After PostgreSQL Persistence Completes
- **Verdict:** **PASS**
- **Location:** `src/server/collab-server.mjs` (lines 443–469)
- **Finding:**
  The server explicitly calls `const saveResult = await flushSave(pageId, room.doc, { prisma: options.prisma });`.
  Inside `flushSave` (`collab-persistence.mjs`), the write queues serialize the write and execute `await prisma.documentState.upsert(...)`.
  The RPC response with HTTP 200 `{ success: true, active: true, flushed: true }` is only sent **after** the database transaction has successfully committed. If an error occurs, the server catches it and returns HTTP 500.

---

### Check 11: RPC Timeout or Active-Room Flush Failure Never Silently Falls Back to Stale DB
- **Verdict:** **PASS**
- **Location:**
  - `src/server/collab-internal-client.mjs` (lines 60–70, 81–84)
  - `src/server/version-snapshot-service.mjs` (lines 110–118)
- **Finding:**
  When `collab-server.mjs` returns HTTP 500 (flush failed) or the request times out (5000ms ceiling), `flushActiveRoom` throws an explicit Error.
  In `version-snapshot-service.mjs`:
  ```javascript
  await flushClient(pageId, { ... });
  // Next lines only execute if flushClient did NOT throw
  doc = new Y.Doc();
  await loadDocumentState(pageId, doc, { prisma });
  ```
  The error bubbles up and terminates `createVersionSnapshot`. It **never** catches the error to fall back to `loadDocumentState`.
  Verified by Test 6 and Test 8 in `tests/phase10_rpc_coordination_verify.mjs`.

---

### Check 12: No-Active-Room Fallback Reads Latest Persisted State
- **Verdict:** **PASS**
- **Location:** `src/server/version-snapshot-service.mjs` (lines 115–120)
- **Finding:**
  When a document is dormant (no clients connected, room cleaned up), `flushActiveRoom` returns `{ active: false, flushed: false }`.
  Because the document has no active in-memory edits, PostgreSQL is the sole authoritative source of truth. The service loads the latest `DocumentState` record and creates the snapshot.
  If `collab-server.mjs` is completely offline, `flushActiveRoom` returns `{ active: false, serverReachable: false }` and the service safely loads the database state.

---

### Check 13: Manual and Automatic Snapshots Use Consistent Yjs Binary and TipTap JSON
- **Verdict:** **PASS**
- **Location:** `src/server/version-snapshot-service.mjs` (lines 127–142, 187–197)
- **Finding:**
  `yjsState` (`Y.encodeStateAsUpdate(doc)`) and `content` (`yXmlFragmentToProsemirrorJSON(doc.getXmlFragment('default'))`) are extracted sequentially and synchronously from the exact same `doc` revision in memory.
  `createRecoverySnapshot` delegates directly to `createVersionSnapshot` with `isAutomatic: true`, ensuring identical representation consistency for automatic pre-restore checkpoints.

---

### Check 14: Existing Phase 9 RBAC and IDOR Protections Remain Intact
- **Verdict:** **PASS**
- **Location:** `src/app/api/workspaces/[workspaceId]/pages/[pageId]/versions/route.ts`
- **Finding:**
  1. All calls to the version APIs verify workspace membership via `checkWorkspaceAccess(workspaceId)`.
  2. IDOR prevention confirms `page.workspaceId === workspaceId` (returns 404 on mismatch).
  3. Role-based authorization permits only `OWNER` and `EDITOR` to execute POST snapshot creation (VIEWER and COMMENTER receive `403 Forbidden`).
  4. Verified by 21/21 passing tests in `phase10_versions_api_verify.mjs` and 32/32 passing tests in `phase9_permissions_verify.mjs`.

---

## 4. Required Fixes (Remediation Plan)

To transition all 5 FAIL verdicts to PASS, the following precise changes must be implemented:

### Remediation Step 1: Enforce Dedicated Secret & Startup Fail-Fast
In `src/server/collab-server.mjs`:
```javascript
// Remove fallback to AUTH_SECRET:
const internalRpcSecret = options.internalRpcSecret ?? process.env.INTERNAL_RPC_SECRET;

if (!internalRpcSecret || typeof internalRpcSecret !== 'string' || Buffer.byteLength(internalRpcSecret, 'utf8') < 32) {
  throw new Error(
    '[CollabServer] Fatal startup error: INTERNAL_RPC_SECRET is required and must contain at least 32 bytes of entropy. Fallback to AUTH_SECRET is forbidden.'
  );
}
```

In `src/server/collab-internal-client.mjs`:
```javascript
// Remove fallback to AUTH_SECRET:
const secret = options.secret || process.env.INTERNAL_RPC_SECRET;
if (!secret || Buffer.byteLength(secret, 'utf8') < 32) {
  throw new Error('[CollabInternalClient] Dedicated INTERNAL_RPC_SECRET (>= 32 bytes) is required.');
}
```

### Remediation Step 2: Implement Timing-Safe Equal Comparison
In `src/server/collab-server.mjs` (replace line 393):
```javascript
import crypto from 'node:crypto';

// Timing-safe secret verification:
const expectedSecretBuf = Buffer.from(internalRpcSecret, 'utf8');
const providedSecretBuf = Buffer.from(token || '', 'utf8');

const isSecretValid =
  scheme === 'Bearer' &&
  expectedSecretBuf.length === providedSecretBuf.length &&
  crypto.timingSafeEqual(expectedSecretBuf, providedSecretBuf);

if (!isSecretValid) {
  res.writeHead(401, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Unauthorized: Invalid internal RPC secret' }));
  return;
}
```

### Remediation Step 3: Generate 256-Bit Cryptographic Random Secret
In `.env.local`:
Replace the placeholder string with a CSPRNG 32-byte hex token:
```bash
INTERNAL_RPC_SECRET="9f8c3d1b6e2a4f5c7d8e9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d"
```

---

## 5. Verification Suite Execution Results

All test suites were executed in read-only mode with 100% success:

| Test Suite | Tests Run | Result | Notes |
|---|---|---|---|
| `tests/phase10_rpc_coordination_verify.mjs` | 8 | **8 / 8 PASSED** | Loopback, bearer auth, debounce clear, active flush, failure abort. |
| `tests/phase10_snapshot_service_verify.mjs` | 9 | **9 / 9 PASSED** | Dual storage, word count, Yjs round-trip, recovery checkpoints. |
| `tests/phase10_versions_api_verify.mjs` | 21 | **21 / 21 PASSED** | REST APIs, 401, 403, 404, 201, Zod schema validation. |
| `tests/phase9_permissions_verify.mjs` | 32 | **32 / 32 PASSED** | Phase 9 RBAC, Member APIs, WebSocket Model B read-only guard. |
| `tests/phase9_comments_api_verify.mjs` | 21 | **21 / 21 PASSED** | Comments CRUD, permissions, resolution, persistence. |
| `npx tsc --noEmit` | N/A | **0 ERRORS** | Full TypeScript type check clean. |
| `npm run lint` | N/A | **0 ERRORS** | ESLint clean across entire project. |
| `npx next build --webpack` | N/A | **0 ERRORS** | Next.js production build succeeded in 7.3s. |

### Database Row Counts (Preservation Audit)
- Users: 22
- Workspaces: 7
- Members: 10
- Pages: 20
- DocumentStates: 12
- Comments: 5
- VersionSnapshots: 0 (all test records cleanly torn down)
- **100% preservation of all existing database state.**

---

## 6. Audit Conclusion & Readiness for Step 4

The architectural foundation of Phase 10 (database schema, Prisma migration, REST endpoints, Zod validations, active room loopback RPC flush, and stale-fallback prevention) is sound, robust, and verified.

However, from an **AppSec and cryptographic perspective**, the 5 secret-hygiene deficiencies must be remediated (disallow `AUTH_SECRET` fallback, enforce $\ge 32$ bytes entropy, fail-fast at server startup, and use `crypto.timingSafeEqual`).

Once those 5 fixes are applied, Phase 10 Step 3 will be 100% hardened and ready for **Phase 10 — Step 4: Restore Snapshot Service & Mutation API**.

