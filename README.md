# Real-Time Collaborative Workspace (Notion/Figma Style)

A high-performance, real-time collaborative workspace web application inspired by Notion and Figma. Built with Next.js App Router, TypeScript, Tailwind CSS, TipTap, Yjs (CRDTs), PostgreSQL, Prisma ORM, WebSockets, and Redis.

> **Internship Project Window:** 20 October 2026 – 20 November 2026  
> **Budget Target:** ₹0 (Strictly Free and Open-Source tools only)  
> **Single Source of Truth:** Guided by the four architectural blueprint documents in this repository (`01_ARCHITECTURE.md`, `02_UI_DESIGN_WORKFLOW.md`, `03_DEVELOPMENT_PHASES.md`, `04_PRD.md`).

---

## 🚀 Project Overview

The goal of this project is to provide a clean, responsive, and seamless shared workspace where authenticated users can:
- Create workspaces and hierarchical rich-text pages.
- Simultaneously edit documents with real-time CRDT conflict-free synchronization via **Yjs**.
- View live presence avatars, selection highlights, and collaborator cursors via **y-websocket**.
- Persist both structured application metadata and binary CRDT document state (`BYTEA`) in **PostgreSQL** using **Prisma**.
- Discuss content through comments and restore point-in-time document states via version snapshots.
- Scale across multiple collaboration server instances using **Redis** pub/sub broadcasting.
- Enforce strict server-side role-based access control (**Owner**, **Editor**, **Commenter**, **Viewer**).

---

## 🛠️ Mandatory Technology Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Framework & UI** | Next.js (App Router), React, TypeScript | Core web application, server-rendered views, client interactivity |
| **Styling** | Tailwind CSS | Notion-inspired minimal design system, neutral light theme |
| **Rich-Text Engine** | TipTap | Headless editor body, formatting toolbars, document DOM |
| **CRDT Collaboration** | Yjs | Conflict-free replicated data type merging concurrent edits |
| **Transport** | WebSockets (`y-websocket`) | Low-latency duplex communication for document updates and awareness |
| **Scaling Adapter** | Redis | Cross-instance sync and pub/sub message coordination |
| **Database & ORM** | PostgreSQL & Prisma ORM | Relational models for users, workspaces, pages, comments, and binary Yjs state |
| **Iconography** | Lucide React | Clean, minimal UI icons |

---

## 📁 Scalable Project Folder Structure

```text
├── 01_ARCHITECTURE.md         # Architecture blueprint & data separation specs
├── 02_UI_DESIGN_WORKFLOW.md     # UI layout, design tokens & user workflow specs
├── 03_DEVELOPMENT_PHASES.md     # 14 development phases & exit criteria
├── 04_PRD.md                    # Product Requirements Document
├── .env.example                 # Placeholder environment variables template
├── .gitignore                   # Clean ignore rules (secrets & build outputs excluded)
├── package.json                 # Dependency manifest and scripts
├── tsconfig.json                # TypeScript compiler configuration
├── next.config.ts               # Next.js configuration
├── eslint.config.mjs            # ESLint rules and Next.js configuration
├── public/                      # Static assets & icons
└── src/
    ├── app/                     # Next.js App Router routes & layouts
    │   ├── layout.tsx           # Root layout with Geist font, ToastProvider & light theme
    │   ├── globals.css          # Tailwind CSS styles & Notion color variables
    │   ├── page.tsx             # Home / project portal with route navigation
    │   ├── error.tsx            # Global error boundary with retry & dashboard redirect
    │   ├── not-found.tsx        # Notion-style 404 not found handler
    │   ├── login/
    │   │   └── page.tsx         # /login placeholder route
    │   ├── signup/
    │   │   └── page.tsx         # /signup placeholder route
    │   ├── dashboard/
    │   │   ├── page.tsx         # /dashboard workspace dashboard with search & empty states
    │   │   └── loading.tsx      # Dashboard skeleton loading state
    │   └── workspace/
    │       └── [workspaceId]/
    │           ├── page.tsx     # /workspace/[workspaceId] collaborative editor route
    │           └── loading.tsx  # Workspace skeleton loading state
    ├── components/              # Modular, reusable UI components
    │   ├── layout/
    │   │   └── AppShell.tsx     # Responsive shell (collapsible sidebar + top bar + share modal)
    │   ├── workspace/
    │   │   ├── WorkspaceSidebar.tsx # Notion-style sidebar with search dialog & profile
    │   │   ├── WorkspaceSwitcher.tsx# Multi-workspace dropdown switcher & creation modal
    │   │   └── PageTree.tsx         # Hierarchical nested page tree with expand/collapse & actions
    │   └── ui/
    │       ├── Button.tsx       # Reusable button with Notion variant tokens
    │       ├── Input.tsx        # Reusable input field with label and error states
    │       ├── Dialog.tsx       # Accessible modal dialog with backdrop & ESC dismiss
    │       ├── Skeleton.tsx     # Notion pulse placeholder skeleton
    │       └── Toast.tsx        # Toast alert notification provider & cards (success/error/info)
    └── lib/
        ├── types.ts             # Domain models (User, Workspace, PageItem, Roles)
        └── utils.ts             # Utility helpers (class name merging)
```

---

## 🚦 Development Status

Development follows the completion-based plan in `03_DEVELOPMENT_PHASES.md`:

- [x] **Phase 1: Project Foundation** (Next.js App Router, TypeScript, Tailwind CSS, ESLint, responsive app shell, placeholder routes `/login`, `/signup`, `/dashboard`, `/workspace/[workspaceId]`, `.env.example`, `.gitignore`, `README.md`).
- [x] **Phase 2: UI Shell and Navigation** (Reusable `Dialog`, `Skeleton`, `Toast`, `WorkspaceSwitcher`, nested `PageTree` with expand/collapse, dashboard search & empty states, loading skeletons, error boundary, and responsive drawer).
- [ ] **Phase 3:** Authentication (Sessions, Password hashing, Route protection)
- [ ] **Phase 4:** PostgreSQL, Prisma, and Workspace Data CRUD
- [ ] **Phase 5:** TipTap Rich-Text Editor Integration
- [ ] **Phase 6:** Yjs and WebSocket Collaboration
- [ ] **Phase 7:** Live Presence and Colored Cursors
- [ ] **Phase 8:** Collaborative Document Persistence in PostgreSQL
- [ ] **Phase 9:** Comments and Role-Based Permissions
- [ ] **Phase 10:** Version History Snapshots & Restoration
- [ ] **Phase 11:** Redis Multi-Instance Pub/Sub Coordination
- [ ] **Phase 12:** Quality Assurance, Security, and Edge-Case Testing
- [ ] **Phase 13:** Free-Tier Deployment (Vercel & Render)
- [ ] **Phase 14:** Submission, Demo Video & Presentation

---

## 💻 Installation & Local Development

### Prerequisites
- **Node.js**: v20 or higher (v22 LTS recommended)
- **npm**: v10 or higher
- **Git**

### 1. Clone & Install Dependencies
```bash
# Clone the repository
git clone <repository-url>
cd "Real-Time Collaborative Workspace"

# Install dependencies
npm install
```

### 2. Configure Environment Variables
Copy the placeholder configuration:
```bash
cp .env.example .env.local
```
*(In Phase 1, `.env.example` contains placeholders. Actual database and secret values will be configured in subsequent phases.)*

### 3. Run Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

### 4. Verified Routes
- **Home / Hub:** `http://localhost:3000/`
- **Login:** `http://localhost:3000/login`
- **Signup:** `http://localhost:3000/signup`
- **Dashboard:** `http://localhost:3000/dashboard`
- **Workspace Editor:** `http://localhost:3000/workspace/ws-main`

---

## 📜 Available NPM Commands

| Command | Action |
|---|---|
| `npm run dev` | Starts the Next.js local development server on port 3000 |
| `npm run build` | Compiles the production build with TypeScript checking and optimizations |
| `npm run start` | Launches the compiled Next.js production server |
| `npm run lint` | Runs ESLint to check for syntax and style issues |

---

## 🔒 Budget & Security Policy

1. **₹0 Budget:** This project uses 100% free and open-source software. No paid tiers, commercial subscriptions, or credit card trials are activated.
2. **Secrets Protection:** No `.env` or sensitive credentials are ever committed to version control.
3. **Data Integrity:** Strict server-side verification ensures authorization is validated on both REST API endpoints and WebSocket connection handshakes.

