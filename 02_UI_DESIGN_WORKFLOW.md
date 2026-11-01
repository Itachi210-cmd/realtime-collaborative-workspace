# UI Design and User Workflow

## 1. Design Direction

**Concept:** A clean, professional Notion-inspired workspace with a
modern collaborative editor.

-   Light theme by default.
-   Neutral backgrounds, restrained borders, readable typography.
-   One accent colour for primary actions and user-presence highlights.
-   Avoid overloading the screen with decorative cards.
-   Use responsive layouts for laptop and mobile-width screens.
-   Meet basic accessibility needs: keyboard focus, readable contrast,
    labels, and clear error states.

## 2. Global Navigation

### Desktop layout

-   **Left sidebar:** workspace switcher, search, page tree, create-page
    action, settings.
-   **Main content:** breadcrumb, page title, formatting toolbar,
    rich-text editor.
-   **Top-right area:** avatars of collaborators, share/permissions
    control, save/sync status, page menu.
-   **Optional right panel:** comments and version history, opened on
    demand.

### Mobile layout

-   Sidebar becomes a drawer.
-   Editor takes the full available width.
-   Presence avatars remain visible in a compact row.
-   Comments and history open in a drawer or dedicated panel.
-   Formatting toolbar may scroll horizontally.

## 3. Main Screens

### A. Login / Sign Up

Components: - Product name and short value statement. - Email and
password fields. - Sign in / create account action. - Inline validation
and clear error messages. - Loading and success states.

Success flow: authenticated user → workspace dashboard.

### B. Workspace Dashboard

Components: - Workspace selector. - Welcome/header area. - Recent pages
list. - Page search. - Create workspace and create page actions. - Empty
state explaining how to start.

Actions: 1. Create workspace. 2. Open existing workspace. 3. Create a
page. 4. Invite/add a member if membership management is in scope.

### C. Workspace Page Tree

Components: - Expand/collapse nested pages. - Page title and active-page
indicator. - New page action. - Page context menu for rename, move, or
delete (respect permissions). - Search/filter pages.

### D. Collaborative Editor

Components: - Breadcrumb: Workspace / Page. - Editable page title. -
Formatting toolbar: paragraph, heading levels, bold, italic, underline
if supported, bullet list, numbered list, link, quote, undo/redo where
compatible. - TipTap editor body. - Collaborator avatars and coloured
cursors. - Sync state: Connecting, Live, Reconnecting, Offline/Not
synced. - Share button and permission summary. - Comments and version
history entry points.

Critical behaviour: - Do not show "Saved" until persistence has actually
completed. - If the WebSocket disconnects, show a visible
reconnecting/offline indicator. - Avoid replacing the editor state with
a stale API response after collaboration has started. - Make permission
restrictions clear in the UI and enforce them on the server.

### E. Comments

Components: - Comment list and author/time. - Add comment field. -
Resolve/unresolve action if implemented. - Empty state. -
Permission-aware controls.

For the MVP, page-level comments are acceptable. Text-anchored comments
can be added if time permits and the anchoring behaviour can be tested.

### F. Version History

Components: - List of snapshots with timestamp and creator. - Preview or
summary where feasible. - Restore action with confirmation. - Current
version indicator.

Restoration must create a new current state or recovery snapshot before
replacing the visible state. Do not silently destroy the current
version.

### G. Share and Permissions

Components: - Member list. - Role selector: Viewer, Commenter, Editor;
Owner management. - Add member/invite flow if supported. - Permission
descriptions. - Save/cancel states and clear success/error feedback.

## 4. Core User Workflow

``` text
Open app
  ↓
Sign up / Sign in
  ↓
Workspace dashboard
  ↓
Create or open workspace
  ↓
Create or open page
  ↓
Load persisted Yjs document
  ↓
Connect to WebSocket room
  ↓
See online collaborators and cursors
  ↓
Edit simultaneously
  ↓
Yjs merges concurrent changes
  ↓
Persist document state and show sync status
  ↓
Comment / inspect history / manage access
```

## 5. UI States to Design and Test

-   Loading workspace/page.
-   Empty workspace and empty page.
-   Saving/synchronizing.
-   Live and connected.
-   Reconnecting after temporary network loss.
-   Offline or server unavailable.
-   Permission denied / read-only page.
-   Invalid form input.
-   Not found / deleted page.
-   Comment posted or failed.
-   Snapshot created or restored.
-   Mobile sidebar open/closed.
-   No collaborators online.

## 6. Interaction Rules

-   Use optimistic UI only where safe and reconcile errors visibly.
-   Keep unsynced status visible if a save fails.
-   Confirm destructive actions such as deleting a page or restoring a
    snapshot.
-   Disable editing controls for viewers.
-   Do not rely on colour alone to identify collaborators; include
    names/initials and accessible labels.
-   Use distinct but readable cursor colours, selected from a consistent
    palette.
-   Preserve keyboard navigation in the editor and menus.

## 7. Suggested UI Component Structure

``` text
components/
  auth/
    LoginForm.tsx
    SignupForm.tsx
  workspace/
    WorkspaceSwitcher.tsx
    WorkspaceSidebar.tsx
    PageTree.tsx
    WorkspaceDashboard.tsx
  editor/
    CollaborativeEditor.tsx
    EditorToolbar.tsx
    CollaboratorAvatars.tsx
    ConnectionStatus.tsx
  comments/
    CommentPanel.tsx
    CommentItem.tsx
  history/
    VersionHistoryPanel.tsx
    SnapshotItem.tsx
  sharing/
    ShareDialog.tsx
    RoleSelector.tsx
  ui/
    Button.tsx
    Dialog.tsx
    Input.tsx
    Skeleton.tsx
    Toast.tsx
```

## 8. UI Acceptance Checklist

-   User can reach a page from the workspace sidebar.
-   Active page is visually clear.
-   Formatting actions work and survive refresh.
-   Online users and cursor presence update without refreshing.
-   Connection problems are visible and do not falsely claim data is
    saved.
-   Role restrictions are reflected in the UI and enforced by the
    server.
-   Comments and snapshots are understandable and usable.
-   Layout remains usable at common desktop and mobile widths.
