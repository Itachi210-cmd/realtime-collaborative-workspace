"use client";

import React, { useState, useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  FileText,
  Users,
  History,
  MessageSquare,
  Shield,
  Zap,
  ArrowRight,
  Sun,
  Moon,
  Menu,
  X,
} from "lucide-react";

const emptySubscribe = () => () => {};
const themeListeners = new Set<() => void>();
function subscribeTheme(callback: () => void) {
  themeListeners.add(callback);
  return () => {
    themeListeners.delete(callback);
  };
}

function getThemeSnapshot(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  try {
    const saved = localStorage.getItem("collab-theme") as "light" | "dark" | null;
    if (saved === "light" || saved === "dark") return saved;
    if (window.matchMedia("(prefers-color-scheme: dark)").matches) return "dark";
  } catch {}
  return "light";
}

function getServerThemeSnapshot(): "light" | "dark" {
  return "light";
}

export default function HomePage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false);
  const theme = useSyncExternalStore(subscribeTheme, getThemeSnapshot, getServerThemeSnapshot);

  useEffect(() => {
    if (!mounted) return;
    document.documentElement.setAttribute("data-theme", theme);
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [theme, mounted]);

  const handleToggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    try {
      localStorage.setItem("collab-theme", next);
    } catch {}
    themeListeners.forEach((l) => l());
  };

  const coreFeatures = [
    {
      title: "Real-Time Collaborative Editing",
      description:
        "Sub-millisecond synchronization ensures concurrent keystrokes merge seamlessly without overwrite conflicts or data loss.",
      icon: Zap,
    },
    {
      title: "Editorial Manuscript Canvas",
      description:
        "A distraction-free writing surface calibrated to a 65–75 character reading measure with refined typography and floating controls.",
      icon: FileText,
    },
    {
      title: "Comments & Marginalia",
      description:
        "Contextual feedback anchored directly to text, supporting threaded discussions, inline replies, and resolved status tracking.",
      icon: MessageSquare,
    },
    {
      title: "Archival Version History",
      description:
        "Named snapshots and automated recovery backups allow instant side-by-side preview and safe document restoration at any point.",
      icon: History,
    },
    {
      title: "Collaborator Presence & Awareness",
      description:
        "Real-time cursor indicators, live user avatar clusters, and continuous connection health monitoring keep teams in lockstep.",
      icon: Users,
    },
    {
      title: "Role-Based Access Governance",
      description:
        "Precise permissions for Workspace Owners, Editors, and Viewers with secure, tokenized link sharing.",
      icon: Shield,
    },
  ];

  return (
    <div className="min-h-screen bg-[var(--bg-app)] text-[var(--text-primary)] flex flex-col font-sans transition-colors duration-150">
      {/* 1. Global Navigation */}
      <header className="h-14 border-b border-[var(--border-subtle)] px-4 sm:px-8 flex items-center justify-between bg-[var(--bg-surface)]/90 backdrop-blur-xs sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md bg-[var(--accent-light)] text-[var(--accent)] border border-[var(--accent-border)]/40 flex items-center justify-center font-mono text-xs font-semibold">
              W
            </div>
            <span className="font-medium text-sm tracking-tight text-[var(--text-primary)]">
              CollabWorkspace
            </span>
          </Link>
        </div>

        {/* Desktop Navigation Links */}
        <nav className="hidden md:flex items-center gap-6 text-xs text-[var(--text-muted)] font-medium">
          <a href="#features" className="hover:text-[var(--text-primary)] transition-colors">
            Features
          </a>
          <a href="#preview" className="hover:text-[var(--text-primary)] transition-colors">
            Workspace Preview
          </a>
          <Link href="/dashboard" className="hover:text-[var(--text-primary)] transition-colors">
            Dashboard
          </Link>
        </nav>

        {/* Desktop Actions */}
        <div className="hidden sm:flex items-center gap-2">
          {mounted && (
            <button
              onClick={handleToggleTheme}
              className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] transition-colors cursor-pointer"
              aria-label="Toggle theme"
            >
              {theme === "dark" ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
            </button>
          )}
          <Link
            href="/login"
            className="inline-flex items-center justify-center font-medium rounded-md transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20 text-[var(--text-primary)] hover:bg-[var(--bg-hover)] text-xs px-2.5 py-1 gap-1.5 h-7 cursor-pointer"
          >
            Sign in
          </Link>
          <Link
            href="/signup"
            className="inline-flex items-center justify-center font-medium rounded-md transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20 bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] border border-[var(--accent)] text-xs px-2.5 py-1 gap-1.5 h-7 shadow-2xs cursor-pointer"
          >
            Get started
          </Link>
        </div>

        {/* Mobile Menu Button */}
        <div className="flex items-center gap-2 sm:hidden">
          {mounted && (
            <button
              onClick={handleToggleTheme}
              className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-[var(--border-subtle)]"
              aria-label="Toggle theme"
            >
              {theme === "dark" ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
            </button>
          )}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            aria-label="Toggle mobile menu"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </header>

      {/* Mobile Menu Dropdown */}
      {mobileMenuOpen && (
        <div className="sm:hidden border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3 space-y-2">
          <a
            href="#features"
            onClick={() => setMobileMenuOpen(false)}
            className="block py-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            Features
          </a>
          <a
            href="#preview"
            onClick={() => setMobileMenuOpen(false)}
            className="block py-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            Workspace Preview
          </a>
          <Link
            href="/dashboard"
            onClick={() => setMobileMenuOpen(false)}
            className="block py-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            Dashboard
          </Link>
          <div className="pt-2 flex flex-col gap-2 border-t border-[var(--border-subtle)]">
            <Link
              href="/login"
              onClick={() => setMobileMenuOpen(false)}
              className="inline-flex items-center justify-center font-medium rounded-md transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20 bg-[var(--bg-raised)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-xs px-2.5 py-1 gap-1.5 h-7 w-full cursor-pointer"
            >
              Sign in
            </Link>
            <Link
              href="/signup"
              onClick={() => setMobileMenuOpen(false)}
              className="inline-flex items-center justify-center font-medium rounded-md transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20 bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] border border-[var(--accent)] shadow-xs text-xs px-2.5 py-1 gap-1.5 h-7 w-full cursor-pointer"
            >
              Get started
            </Link>
          </div>
        </div>
      )}

      {/* 2. Hero Section */}
      <section className="pt-16 pb-12 sm:pt-24 sm:pb-16 px-4 sm:px-8 max-w-4xl mx-auto text-center space-y-6">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[var(--bg-raised)] border border-[var(--border-subtle)] text-[11px] font-mono text-[var(--text-muted)]">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span>Real-time collaborative workspace</span>
        </div>

        <h1 className="text-3xl sm:text-5xl lg:text-6xl font-serif font-normal text-[var(--text-primary)] tracking-tight leading-[1.15]">
          An editorial workspace for thoughtful, real-time collaboration.
        </h1>

        <p className="text-sm sm:text-base text-[var(--text-muted)] max-w-2xl mx-auto leading-relaxed">
          Draft, refine, and organize long-form documents together. Built on conflict-free synchronization, calm editorial typography, marginalia feedback, and archival version history.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
          <Link
            href="/signup"
            className="inline-flex items-center justify-center font-medium rounded-md transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20 bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] border border-[var(--accent)] shadow-xs text-sm px-5 py-2 gap-2 h-9 w-full sm:w-auto cursor-pointer"
          >
            <span>Get started free</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center font-medium rounded-md transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20 bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-sm px-5 py-2 gap-2 h-9 w-full sm:w-auto cursor-pointer"
          >
            Explore workspace
          </Link>
        </div>
      </section>

      {/* 3. Product Preview Section */}
      <section id="preview" className="px-4 sm:px-8 max-w-5xl mx-auto w-full pb-20">
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-md overflow-hidden">
          {/* Simulated Application Shell Bar */}
          <div className="h-10 border-b border-[var(--border-subtle)] px-4 bg-[var(--bg-raised)]/60 flex items-center justify-between text-xs">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-neutral-300 dark:bg-neutral-700" />
                <span className="w-2.5 h-2.5 rounded-full bg-neutral-300 dark:bg-neutral-700" />
                <span className="w-2.5 h-2.5 rounded-full bg-neutral-300 dark:bg-neutral-700" />
              </div>
              <span className="font-mono text-[11px] text-[var(--text-faint)]">
                Core Engineering Hub / Architecture Blueprint v2
              </span>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 text-[11px] font-mono text-emerald-600 dark:text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                <span>Live</span>
              </div>
              <div className="flex -space-x-1">
                <div className="w-5 h-5 rounded-full bg-[var(--accent)] text-white text-[9px] font-mono flex items-center justify-center font-bold ring-1 ring-[var(--bg-surface)]">
                  IE
                </div>
                <div className="w-5 h-5 rounded-full bg-amber-600 text-white text-[9px] font-mono flex items-center justify-center font-bold ring-1 ring-[var(--bg-surface)]">
                  AR
                </div>
              </div>
            </div>
          </div>

          {/* Simulated Workspace Body: Sidebar + Manuscript Canvas */}
          <div className="grid grid-cols-1 md:grid-cols-12 min-h-[460px]">
            {/* Sidebar Preview Column */}
            <div className="hidden md:block md:col-span-3 border-r border-[var(--border-subtle)] bg-[var(--bg-sidebar)] p-3 space-y-3">
              <div className="flex items-center gap-2 p-1.5 rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs font-medium text-[var(--text-primary)]">
                <div className="w-5 h-5 rounded bg-[var(--accent-light)] text-[var(--accent)] text-[10px] font-mono font-bold flex items-center justify-center">
                  C
                </div>
                <span className="truncate">Core Engineering Hub</span>
              </div>

              <div className="space-y-1 text-xs text-[var(--text-muted)]">
                <div className="px-2 py-1 text-[10px] font-mono uppercase text-[var(--text-faint)]">
                  Documents
                </div>
                <div className="px-2 py-1 rounded bg-[var(--bg-hover)] text-[var(--text-primary)] font-medium flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-[var(--accent)]" />
                  <span className="truncate">Architecture Blueprint v2</span>
                </div>
                <div className="px-2 py-1 rounded hover:bg-[var(--bg-hover)] flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-[var(--text-faint)]" />
                  <span className="truncate">Hydration Protocol</span>
                </div>
                <div className="px-2 py-1 rounded hover:bg-[var(--bg-hover)] flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-[var(--text-faint)]" />
                  <span className="truncate">Sync Engine Debounce</span>
                </div>
              </div>
            </div>

            {/* Manuscript Canvas Column */}
            <div className="md:col-span-9 p-6 sm:p-10 bg-[var(--bg-surface)] flex flex-col justify-between">
              <div className="max-w-xl mx-auto w-full space-y-6">
                {/* Document Header */}
                <div className="space-y-2 pb-4 border-b border-[var(--border-subtle)]/70">
                  <h2 className="text-2xl sm:text-3xl font-serif font-normal text-[var(--text-primary)]">
                    Architecture Blueprint v2
                  </h2>
                  <div className="flex items-center gap-3 text-[11px] font-mono text-[var(--text-faint)]">
                    <span>By Intern Engineer</span>
                    <span>•</span>
                    <span>Nov 10, 2026</span>
                    <span>•</span>
                    <span className="text-emerald-600 dark:text-emerald-400">✓ Saved</span>
                  </div>
                </div>

                {/* Simulated Floating Toolbar */}
                <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[var(--bg-raised)] border border-[var(--border-subtle)] text-xs text-[var(--text-muted)] shadow-2xs font-mono">
                  <span className="px-1 text-[var(--accent)] font-semibold">H1</span>
                  <span className="px-1 hover:text-[var(--text-primary)]">H2</span>
                  <span className="text-[var(--border-subtle)]">|</span>
                  <span className="px-1 font-bold">B</span>
                  <span className="px-1 italic">I</span>
                  <span className="px-1 underline">U</span>
                  <span className="text-[var(--border-subtle)]">|</span>
                  <span className="px-1">“ ”</span>
                  <span className="px-1">&lt;&gt;</span>
                </div>

                {/* Manuscript Paragraph with Live Cursor */}
                <div className="space-y-3 text-sm text-[var(--text-primary)] leading-relaxed font-sans">
                  <p>
                    Distributed collaborative workspaces require deterministic convergence across multi-instance nodes. By modeling document state as a sequence of conflict-free operations, every collaborator experiences zero-latency local updates while remote edits merge smoothly in the background.
                  </p>

                  <div className="relative pl-3 border-l-2 border-[var(--accent)] py-1 bg-[var(--accent-light)]/40 rounded-r-md">
                    <p className="text-xs text-[var(--text-muted)] italic">
                      &ldquo;Every keystroke is synchronized through a resilient WebSocket connection with Redis pub/sub arbitration.&rdquo;
                    </p>
                    <span className="inline-block mt-1 px-1.5 py-0.2 rounded bg-[var(--accent)] text-white text-[9px] font-mono">
                      Alex Rivera (Editing)
                    </span>
                  </div>
                </div>
              </div>

              {/* Bottom Simulation Bar */}
              <div className="pt-6 border-t border-[var(--border-subtle)]/60 flex items-center justify-between text-[11px] font-mono text-[var(--text-faint)]">
                <span>Reading measure: 68ch</span>
                <span>Yjs CRDT synchronized</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 4. Core Features Section */}
      <section id="features" className="py-16 sm:py-24 px-4 sm:px-8 border-t border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        <div className="max-w-5xl mx-auto space-y-12">
          <div className="text-center space-y-2 max-w-xl mx-auto">
            <h2 className="text-xs font-mono uppercase tracking-widest text-[var(--accent)]">
              Crafted for Writing
            </h2>
            <h3 className="text-2xl sm:text-3xl font-serif font-normal text-[var(--text-primary)]">
              Everything teams need to collaborate with clarity.
            </h3>
            <p className="text-xs sm:text-sm text-[var(--text-muted)]">
              Engineered from the ground up to respect authorial focus and eliminate collaborative friction.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {coreFeatures.map((feat) => {
              const Icon = feat.icon;
              return (
                <div
                  key={feat.title}
                  className="p-5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)] hover:border-[var(--border-strong)] transition-all space-y-3"
                >
                  <div className="w-8 h-8 rounded-md bg-[var(--accent-light)] text-[var(--accent)] border border-[var(--accent-border)]/40 flex items-center justify-center">
                    <Icon className="w-4 h-4" />
                  </div>
                  <h4 className="text-sm font-medium text-[var(--text-primary)]">
                    {feat.title}
                  </h4>
                  <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                    {feat.description}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* 5. Closing Call to Action */}
      <section className="py-16 px-4 sm:px-8 max-w-4xl mx-auto text-center space-y-6">
        <div className="space-y-2">
          <h2 className="text-2xl sm:text-4xl font-serif font-normal text-[var(--text-primary)] tracking-tight">
            Start writing together today.
          </h2>
          <p className="text-xs sm:text-sm text-[var(--text-muted)] max-w-md mx-auto">
            Create your collaborative workspace and invite your team to experience thoughtful real-time writing.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            href="/signup"
            className="inline-flex items-center justify-center font-medium rounded-md transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20 bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] border border-[var(--accent)] shadow-xs text-sm px-5 py-1.5 gap-2 h-8 w-full sm:w-auto cursor-pointer"
          >
            Create workspace
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center justify-center font-medium rounded-md transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20 bg-[var(--bg-raised)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-sm px-5 py-1.5 gap-2 h-8 w-full sm:w-auto cursor-pointer"
          >
            Sign in to existing space
          </Link>
        </div>
      </section>

      {/* 6. Product Footer */}
      <footer className="mt-auto border-t border-[var(--border-subtle)] py-8 px-4 sm:px-8 bg-[var(--bg-surface)]">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[var(--text-faint)]">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded bg-[var(--accent-light)] text-[var(--accent)] border border-[var(--accent-border)]/40 flex items-center justify-center font-mono text-[10px] font-bold">
              W
            </div>
            <span className="font-medium text-[var(--text-primary)]">CollabWorkspace</span>
            <span>—</span>
            <span>Real-time collaborative editing</span>
          </div>

          <div className="flex items-center gap-5">
            <Link href="/dashboard" className="hover:text-[var(--text-primary)] transition-colors">
              Dashboard
            </Link>
            <Link href="/login" className="hover:text-[var(--text-primary)] transition-colors">
              Sign in
            </Link>
            <Link href="/signup" className="hover:text-[var(--text-primary)] transition-colors">
              Create account
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
