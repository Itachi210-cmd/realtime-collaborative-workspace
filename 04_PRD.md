# Product Requirements Document (PRD)

## Real-Time Collaborative Workspace --- Notion/Figma-Inspired

**Version:** 1.0\
**Track:** Full-Stack Development\
**Batch start:** 20 October 2026\
**Deadline:** 20 November 2026\
**Estimated effort:** 14 development days\
**Budget:** ₹0 target; no paid tools/services without approval.

## 1. Product Summary

Build a web application that allows multiple authenticated users to
collaborate on rich-text pages in real time. Users can create workspaces
and pages, edit the same document concurrently, see collaborators and
cursors, add comments, review version snapshots, and use
view/comment/edit permissions.

The project demonstrates full-stack engineering, CRDT-based
collaboration, persistence, authorization, testing, and a documented
scaling approach.

## 2. Problem Statement

Traditional document workflows can create delays when people work on
separate copies or rely on repeated refreshes. Concurrent edits may
overwrite each other if the application uses simplistic last-write-wins
updates. Teams need one shared workspace where updates synchronize
quickly, concurrent edits converge, and access is controlled.

## 3. Goals

1.  Support simultaneous editing of one rich-text document by multiple
    users.
2.  Merge concurrent edits with Yjs CRDT semantics.
3.  Show online presence and coloured cursors.
4.  Persist workspace/page data and collaborative document state.
5.  Provide comments, version snapshots, and access roles.
6.  Demonstrate Redis-based coordination for multiple collaboration
    server instances.
7.  Provide a tested repository, setup documentation, demo, and
    presentation.
8.  Keep the project within a zero-paid-tools budget.

## 4. Non-Goals for the First Release

-   Full Figma-grade vector drawing or design canvas.
-   Native mobile applications.
-   Offline-first synchronization across long periods without a
    connection.
-   Enterprise SSO, audit compliance, or advanced organisation billing.
-   File storage and rich attachment management unless time remains.
-   AI writing features.
-   Guaranteeing 24/7 uptime from free hosting tiers.

## 5. Target Users and Roles

### Workspace Owner

Creates and manages the workspace, manages membership and roles, and can
edit all workspace pages.

### Editor

Can read and edit pages where they have edit access.

### Commenter

Can read pages and add comments but cannot change document content.

### Viewer

Can read pages but cannot edit or comment.

The application must enforce these permissions server-side, including
for WebSocket connections.

## 6. Functional Requirements

### FR-01: Authentication

-   Users can register and sign in.
-   Protected pages require a valid session.
-   Invalid credentials and validation errors are shown clearly.
-   Passwords, if managed directly, are stored as secure hashes, never
    plaintext.

**Acceptance:** An unauthenticated user cannot access protected
workspace content.

### FR-02: Workspace Management

-   An authenticated user can create a workspace.
-   A workspace has an owner and member list.
-   Workspace pages and members are visible only to authorized users.

**Acceptance:** A user cannot read or modify another workspace by
changing an ID in a request.

### FR-03: Page Management

-   Users with appropriate permission can create and rename pages.
-   Users can list and open pages in their workspace.
-   Optional nested pages may be supported.
-   Deletion is permission-protected and confirmed.

**Acceptance:** Page metadata persists after refresh and unauthorized
page operations are rejected.

### FR-04: Rich-Text Editor

-   Use TipTap for headings, paragraphs, bold, italic, lists, links, and
    blockquotes as supported.
-   Editor content is represented through a Yjs shared document for
    collaboration.
-   Formatting is retained after reload.

**Acceptance:** Formatting survives reload and concurrent edits do not
replace the whole document with stale content.

### FR-05: Real-Time Collaboration

-   Use Yjs and y-websocket.
-   Two or more browser sessions can edit the same page.
-   Changes synchronize without manual refresh.
-   Concurrent changes converge to a consistent document state.
-   Connection status is visible.

**Acceptance:** A test with at least two clients demonstrates concurrent
editing and eventual convergence.

### FR-06: Presence and Cursors

-   Show online collaborator avatars or initials.
-   Assign a visible cursor colour to each active collaborator.
-   Presence updates as users join or leave.

**Acceptance:** Two browser sessions can identify each other's presence
and cursors.

### FR-07: Document Persistence

-   Persist Yjs document state or updates in PostgreSQL using a
    documented storage adapter.
-   Reload the latest state when a page is opened.
-   Recover content after refresh and collaboration server restart.
-   Make save/sync status truthful.

**Acceptance:** Content remains after browser refresh and server restart
in the tested environment.

### FR-08: Comments

-   Authorized users can create and read page comments.
-   Comments show author and timestamp.
-   Commenter and editor roles can comment; viewer cannot.
-   Text-anchored comments are optional if page-level comments meet the
    MVP schedule.

**Acceptance:** Comments persist and permission checks are tested.

### FR-09: Version History

-   Create named or timestamped snapshots.
-   List previous snapshots with author and time.
-   Restore a selected snapshot after confirmation.
-   Preserve a recovery snapshot before restoration where practical.

**Acceptance:** A user can restore an earlier state and the resulting
document is persisted. The current state must not be silently lost.

### FR-10: Permissions

-   Support Owner, Editor, Commenter, and Viewer roles.
-   Enforce permissions in API operations and collaboration-room
    admission.
-   Prevent read-only users from sending accepted document changes.

**Acceptance:** Negative permission tests pass for API and WebSocket
access.

### FR-11: Redis-Based Scaling

-   Add Redis coordination after single-server collaboration is stable.
-   Use a compatible provider/adapter to broadcast collaboration
    messages across server instances.
-   Test clients connected to separate instances.
-   Document setup and limitations.

**Acceptance:** Cross-instance changes are demonstrated, or the exact
blocker and local test evidence are documented if free hosting limits
prevent a deployed test.

### FR-12: Documentation and Demo

-   Provide a README, environment setup instructions, architecture
    diagram, data/API notes, test results, and demo.
-   Prepare a 10-minute final presentation.
-   Provide an individual reflection based on work actually completed.

**Acceptance:** A reviewer can set up the project by following the
README and understand the design decisions.

## 7. Non-Functional Requirements

### Reliability

-   Reconnect after temporary WebSocket disconnection.
-   Do not treat an in-memory-only document as saved.
-   Surface errors rather than silently losing changes.

### Security

-   Validate and authorize server-side.
-   Store secrets only in environment variables.
-   Hash passwords if handled by the app.
-   Use secure transport in production.
-   Avoid logging passwords, tokens, or document secrets.

### Performance

-   Keep collaboration responsive for a small demo group of
    approximately 2--5 simultaneous clients.
-   Measure and report actual sync behaviour; do not claim unmeasured
    targets as results.
-   Avoid unnecessary database writes and excessive snapshot creation.

### Accessibility and Usability

-   Keyboard-accessible navigation and editor controls.
-   Visible focus states and readable contrast.
-   Do not communicate collaborator identity through colour alone.
-   Responsive layout for desktop and mobile-width screens.

### Cost

-   Target ₹0 spending.
-   Do not enter payment details or activate paid trials.
-   Check current provider free-tier terms before deployment.
-   Use local development and screen recording if free hosting is
    unsuitable.

## 8. Core User Stories

-   As a user, I want to sign in so my workspace is private.
-   As an owner, I want to create a workspace and pages.
-   As a collaborator, I want my edits to appear for other users without
    refreshing.
-   As a collaborator, I want to see who is online and where they are
    editing.
-   As a commenter, I want to discuss a page without editing its
    contents.
-   As a viewer, I want to read a page without changing it.
-   As a user, I want to restore an earlier snapshot after an unwanted
    edit.
-   As a reviewer, I want setup and test documentation so I can verify
    the implementation.

## 9. Success Metrics

The project is successful when: - A new user can register and create a
workspace/page. - At least two browser sessions can edit the same
document concurrently. - The document converges after concurrent
edits. - Cursors and presence are visible. - Content survives refresh
and server restart. - Comments and roles behave as specified. - Version
snapshot restoration works. - Redis coordination is tested across
instances or the limitation is transparently documented. - The
repository, setup guide, demo, test results, and presentation are
ready. - No paid tools or services were activated.

## 10. Risks and Mitigations

  -----------------------------------------------------------------------
  Risk                                Mitigation
  ----------------------------------- -----------------------------------
  Yjs state is not persisted          Implement and test persistence
                                      before polishing secondary features

  WebSocket hosting does not support  Keep local server as baseline;
  long-lived connections              verify hosting support before
                                      deployment

  Free services sleep or impose       Document limitations; use a screen
  limits                              recording as fallback

  Redis adapter is incompatible with  Validate adapter choice before the
  the selected server                 scaling phase

  Permissions are only enforced in UI Add server-side checks for APIs and
                                      WebSocket room admission

  Scope exceeds 14 development days   Prioritize the collaboration MVP,
                                      then comments, permissions,
                                      snapshots, and Redis

  Snapshot restore loses newer edits  Confirm restore and save a recovery
                                      snapshot first
  -----------------------------------------------------------------------

## 11. MVP Priority

### P0 --- Must work

-   Authentication.
-   Workspace/page creation.
-   TipTap editor.
-   Yjs + y-websocket collaboration.
-   Presence/cursors.
-   PostgreSQL persistence for app data and collaborative document
    state.
-   Server-side access checks.
-   Setup README and working demo.

### P1 --- Required project features

-   Comments.
-   Viewer/commenter/editor permissions.
-   Version snapshots and restore.
-   Redis coordination and multi-instance test.

### P2 --- If time remains

-   Nested pages.
-   Search.
-   Page-level activity feed.
-   Text-anchored comments.
-   Extra editor formatting and polish.

## 12. Deliverables

-   Working deployed demo where possible, otherwise screen-recorded
    demo.
-   GitHub repository with clean commits.
-   README and setup instructions.
-   Architecture diagram.
-   Data model and API documentation.
-   Test results and measured performance evidence.
-   10-minute presentation.
-   Individual reflection.
