# Development Phases --- Completion-Based Execution Plan

## 1. Planning Principles

-   Internship deadline: **20 November 2026**.
-   The brief estimates 14 days of effort, but this project will **not**
    follow a fixed day-wise schedule.
-   Work at a sustainable pace: complete as much as is practical in each
    session.
-   Move to the next phase only when the current phase's exit criteria
    are met.
-   Target budget: **₹0**. Do not enable paid plans, paid trials, or
    paid resources.
-   Keep time for testing, bug fixing, documentation, deployment
    attempts, and the final presentation.

The phases below are sequential milestones, not daily targets. A phase
may take more or less than one day.

## 2. Development Phases

### Phase 1 --- Project Foundation

**Tasks** - Create the GitHub repository. - Set up Next.js with
TypeScript. - Configure linting and project scripts. - Create the
initial application layout and route structure. - Add `.env.example` and
confirm secrets are excluded from Git.

**Exit criteria** - Application starts locally. - Folder structure and
scripts are clear. - Initial commit is pushed to GitHub.

### Phase 2 --- UI Shell and Navigation

**Tasks** - Build the responsive application shell. - Create the
sidebar, workspace switcher, page navigation, and dashboard. - Add
loading, empty, and error states. - Establish reusable UI components and
design tokens.

**Exit criteria** - Main screens can be navigated. - Desktop layout is
usable and mobile-width layout does not break. - UI components are
reusable and consistently styled.

### Phase 3 --- Authentication

**Tasks** - Implement signup and login. - Add session handling and
protected routes. - Add validation and useful error messages. - Securely
hash passwords if credentials are managed directly.

**Exit criteria** - Users can register and sign in. - Unauthenticated
users cannot access protected workspace routes. - Secrets are not
committed or exposed to the browser.

### Phase 4 --- PostgreSQL, Prisma, and Workspace Data

**Tasks** - Set up PostgreSQL locally. - Configure Prisma and
migrations. - Create User, Workspace, WorkspaceMember, and Page
models. - Add workspace and page CRUD operations. - Enforce ownership
and membership checks on the server.

**Exit criteria** - Database migrations run successfully. - Users can
create and access their own workspaces and pages. - Unauthorized
workspace/page access is rejected.

### Phase 5 --- Rich-Text Editor

**Tasks** - Integrate TipTap. - Add core formatting: paragraphs,
headings, bold, italic, lists, links, and blockquotes. - Implement page
title editing. - Add editor loading and error states.

**Exit criteria** - Users can create and edit formatted content. -
Editor state behaves correctly through normal navigation. - The editor
is ready to be connected to Yjs.

### Phase 6 --- Yjs and WebSocket Collaboration

**Tasks** - Connect TipTap to a Yjs shared document. - Run a local
`y-websocket` server. - Use one collaboration room per page. - Connect
multiple browser sessions to the same room. - Add reconnect handling and
visible connection status.

**Exit criteria** - At least two browser sessions can edit the same
page. - Changes synchronize without manual refresh. - Concurrent edits
converge to a consistent document state.

### Phase 7 --- Presence and Cursors

**Tasks** - Integrate Yjs awareness/presence. - Show collaborator
avatars or initials. - Assign visible cursor colours. - Handle users
joining and leaving.

**Exit criteria** - Collaborators can see each other's presence and
cursors in real time. - Presence clears correctly when a user
disconnects.

### Phase 8 --- Collaborative Document Persistence

**Tasks** - Design the Yjs persistence adapter. - Persist encoded Yjs
state or updates in PostgreSQL. - Load stored state when a page room
starts. - Save updates safely and handle shutdown/reconnect scenarios. -
Show an accurate saved/sync status.

**Exit criteria** - Document content survives browser refresh. -
Document content survives collaboration server restart. - The UI never
reports saved when persistence has failed.

### Phase 9 --- Comments and Permissions

**Tasks** - Implement page-level comments. - Add Owner, Editor,
Commenter, and Viewer roles. - Enforce role permissions in APIs. -
Validate authorization before allowing a user into a WebSocket room. -
Prevent read-only users from submitting document changes.

**Exit criteria** - Comments persist and display author/time. - Viewer
can read only. - Commenter can read and comment but cannot edit. -
Editor can edit. - Unauthorized API and WebSocket access is rejected.

### Phase 10 --- Version History

**Tasks** - Create version snapshots from persisted Yjs state. - Display
snapshot author and timestamp. - Add restore confirmation. - Preserve a
recovery snapshot before restoring an older version.

**Exit criteria** - Users can list available snapshots. - A selected
snapshot can be restored. - Restored content persists and the previous
current state is recoverable.

### Phase 11 --- Redis and Multi-Instance Coordination

**Tasks** - Confirm the chosen Yjs/WebSocket server architecture
supports the intended Redis adapter/provider. - Configure Redis-based
message coordination. - Run multiple collaboration server instances
locally or in a suitable environment. - Connect different clients to
different instances. - Verify document updates and presence across
instances.

**Exit criteria** - Cross-instance collaboration is demonstrated with
test evidence. - If a free hosting limitation prevents a deployed
multi-instance test, record the limitation and retain local test
evidence. - Do not assume that installing Redis alone enables
multi-instance Yjs synchronisation.

### Phase 12 --- Quality Assurance and Security

**Tasks** - Run functional tests for authentication, workspace, pages,
comments, snapshots, and roles. - Test concurrent edits, reconnects,
refreshes, and server restarts. - Test unauthorized API and WebSocket
access. - Fix critical bugs and regressions. - Record measured sync
behaviour and test environment.

**Exit criteria** - Critical user flows pass. - Permission tests pass. -
Collaboration and persistence tests pass. - Test results are documented;
performance numbers are measured, not invented.

### Phase 13 --- Free-Tier Deployment

**Tasks** - Verify current free-tier terms before creating any hosted
resource. - Deploy Next.js to Vercel if the free tier is suitable. -
Deploy the WebSocket/backend service to Render or another provider only
if its current plan supports the required long-lived WebSocket
behaviour. - Select a free PostgreSQL and Redis option only after
checking limits, sleep behaviour, storage, connection caps, and
expiry. - Configure production environment variables and HTTPS/WSS. - Do
not enter payment details, activate paid trials, or enable paid
resources.

**Exit criteria** - Public demo works within verified free-tier limits;
or - A clear screen-recorded local demo is ready if reliable free
hosting is not available.

### Phase 14 --- Documentation and Submission

**Tasks** - Write the README and setup instructions. - Add architecture
diagram and data/API documentation. - Document environment variables
without exposing secrets. - Add test results and measured performance
observations. - Record a working demo. - Prepare the 10-minute
presentation. - Write an individual reflection describing actual work
owned and lessons learned.

**Exit criteria** - GitHub repository is clean and understandable. - A
reviewer can follow the setup guide. - All internship deliverables are
ready for submission.

## 3. Definition of Done for Every Feature

A feature is complete only when it: 1. Works in the intended user flow.
2. Validates invalid input. 3. Handles loading and failure states. 4.
Enforces authorization on the server. 5. Persists data when persistence
is expected. 6. Has at least one normal-path and one failure-path test.
7. Has a clear Git commit reflecting the actual work completed.

## 4. Testing Checklist

### Functional tests

-   [ ] Signup/login and protected routes.
-   [ ] Create workspace and page.
-   [ ] Rename, open, and delete page with correct permissions.
-   [ ] Add and view comments.
-   [ ] Create and restore a version snapshot.
-   [ ] Viewer cannot edit; commenter cannot edit; editor can edit.

### Collaboration tests

-   [ ] Open the same page in 2--3 separate browser sessions.
-   [ ] Type simultaneously at different positions.
-   [ ] Type at the same location and verify convergence.
-   [ ] Disconnect and reconnect one browser.
-   [ ] Refresh a browser and verify content recovery.
-   [ ] Restart the collaboration server and verify persisted state
    loads.
-   [ ] Verify presence/cursors update when users disconnect.

### Security tests

-   [ ] Try accessing a page without membership.
-   [ ] Try editing as a viewer.
-   [ ] Try joining a WebSocket room without valid authentication.
-   [ ] Confirm secrets are absent from the repository and browser
    bundle.
-   [ ] Verify user-supplied IDs do not bypass authorization.

### Scaling tests

-   [ ] Connect clients to different WebSocket instances.
-   [ ] Verify document updates and presence are coordinated.
-   [ ] Record exact configuration and test evidence.
-   [ ] Document any free-tier limitation that prevents deployed
    multi-instance testing.

## 5. Git Workflow

Suggested commit sequence: - `chore: initialize Next.js app` -
`feat: add workspace layout` - `feat: implement authentication` -
`feat: add Prisma schema and workspace APIs` -
`feat: add page management` - `feat: integrate TipTap editor` -
`feat: add Yjs collaboration` - `feat: add WebSocket presence` -
`feat: persist collaborative document state` -
`feat: add comments and permissions` - `feat: add version snapshots` -
`feat: configure Redis coordination` -
`test: add collaboration and authorization tests` -
`docs: add setup guide and demo instructions`

Use small commits that reflect actual completed work; do not create
misleading commits for features that are not implemented.

## 6. Final Submission Checklist

-   [ ] Working demo or screen recording.
-   [ ] GitHub repository with clean commit history.
-   [ ] README with setup instructions and environment variables.
-   [ ] Architecture diagram.
-   [ ] Data model and API documentation.
-   [ ] Test results and measured performance notes where applicable.
-   [ ] 10-minute presentation: problem, design, challenges, results,
    next steps.
-   [ ] Individual reflection describing actual ownership and lessons
    learned.
-   [ ] No paid services activated; free-tier constraints documented.
