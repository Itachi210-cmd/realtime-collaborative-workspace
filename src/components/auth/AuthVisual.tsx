"use client";

import React from "react";
import Link from "next/link";
import { ArrowLeft, Check, Users, FileText } from "lucide-react";

interface AuthVisualProps {
  title?: string;
  description?: string;
  activeDot?: number;
  backHref?: string;
  backLabel?: string;
}

export function AuthVisual({
  title = "Work better, together.",
  description = "A quiet, real-time editorial canvas where writers, researchers, and teams craft ideas synchronously with zero distraction.",
  activeDot = 0,
  backHref = "/",
  backLabel = "Back to home",
}: AuthVisualProps) {
  return (
    <div className="relative flex flex-col justify-between h-full p-6 sm:p-10 lg:p-12 bg-gradient-to-br from-[var(--bg-app)] to-[var(--bg-surface)] border-b lg:border-b-0 lg:border-r border-[var(--border-subtle)] overflow-hidden select-none">
      {/* Background Decorative Rings (Editorial geometric curves matching reference) */}
      <div className="absolute -top-16 -left-16 w-64 h-64 rounded-full border border-[var(--accent)]/15 pointer-events-none" />
      <div className="absolute top-1/2 -right-20 -translate-y-1/2 w-72 h-72 rounded-full border border-[var(--border-strong)]/20 pointer-events-none" />
      <div className="absolute -bottom-16 -left-10 w-48 h-48 rounded-full border border-[var(--accent)]/10 pointer-events-none" />

      {/* Top Navigation: Back to Home */}
      <div className="relative z-10">
        <Link
          href={backHref}
          className="inline-flex items-center gap-2 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors group cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5 transition-transform duration-150 group-hover:-translate-x-0.5" />
          <span>{backLabel}</span>
        </Link>
      </div>

      {/* Center Section: Editorial Heading, Description & Illustration */}
      <div className="relative z-10 my-auto py-8">
        <div className="max-w-md mx-auto text-center">
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-serif text-[var(--text-primary)] tracking-tight leading-tight">
            {title}
          </h2>
          <p className="mt-2.5 text-xs sm:text-sm text-[var(--text-muted)] leading-relaxed">
            {description}
          </p>
        </div>

        {/* Custom Editorial Collaborative Visual */}
        <div className="relative mt-8 max-w-sm sm:max-w-md mx-auto">
          {/* Main Document Canvas Card */}
          <div className="relative bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl p-5 shadow-sm">
            {/* Document Header */}
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-[var(--border-subtle)]">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-md bg-[var(--accent-light)] text-[var(--accent)] border border-[var(--accent-border)]/40 flex items-center justify-center">
                  <FileText className="w-3.5 h-3.5" />
                </div>
                <div>
                  <div className="text-xs font-serif font-medium text-[var(--text-primary)]">
                    Quarterly Editorial Draft
                  </div>
                  <div className="text-[10px] font-mono text-[var(--text-faint)]">
                    Synced with 4 collaborators
                  </div>
                </div>
              </div>

              {/* Status Indicator */}
              <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[var(--accent-light)] border border-[var(--accent-border)]/30 text-[10px] font-mono text-[var(--accent)] font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
                <span>Live</span>
              </div>
            </div>

            {/* Document Manuscript Body Lines */}
            <div className="space-y-2">
              <div className="h-2 w-11/12 rounded-full bg-[var(--border-strong)]/30" />
              <div className="h-2 w-full rounded-full bg-[var(--border-strong)]/20" />

              {/* Active Collaborator Selection Highlight */}
              <div className="relative my-2 p-2 rounded bg-[var(--accent-light)]/60 border-l-2 border-[var(--accent)]">
                <p className="text-[11px] font-serif italic text-[var(--text-primary)] leading-tight">
                  &ldquo;Clear thinking requires quiet surfaces and unhurried prose.&rdquo;
                </p>
                {/* Active Cursor Flag */}
                <div className="absolute -top-2.5 right-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[var(--accent)] text-white text-[9px] font-medium shadow-xs">
                  <span>Elena V.</span>
                </div>
              </div>

              <div className="h-2 w-4/5 rounded-full bg-[var(--border-strong)]/25" />
              <div className="h-2 w-9/12 rounded-full bg-[var(--border-strong)]/20" />
            </div>
          </div>

          {/* Floating Element 1: Comment Thread Callout (Top Right) */}
          <div className="absolute -top-5 -right-2 sm:-right-4 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg p-2.5 shadow-md flex items-start gap-2 max-w-[190px] animate-fade-in">
            <div className="w-6 h-6 rounded-full bg-[var(--accent)] text-white text-[10px] font-semibold flex items-center justify-center shrink-0">
              AR
            </div>
            <div className="text-[10px] leading-snug">
              <span className="font-medium text-[var(--text-primary)] block">Alex Rivera</span>
              <span className="text-[var(--text-muted)] line-clamp-1">Refined this paragraph</span>
            </div>
          </div>

          {/* Floating Element 2: Presence Stack (Bottom Left) */}
          <div className="absolute -bottom-4 -left-2 sm:-left-4 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg py-1.5 px-2.5 shadow-md flex items-center gap-2">
            <div className="flex -space-x-1.5">
              <div className="w-5 h-5 rounded-full bg-stone-700 text-stone-100 text-[9px] font-semibold flex items-center justify-center ring-2 ring-[var(--bg-surface)]">
                MK
              </div>
              <div className="w-5 h-5 rounded-full bg-[var(--accent)] text-white text-[9px] font-semibold flex items-center justify-center ring-2 ring-[var(--bg-surface)]">
                SL
              </div>
              <div className="w-5 h-5 rounded-full bg-stone-500 text-white text-[9px] font-semibold flex items-center justify-center ring-2 ring-[var(--bg-surface)]">
                JD
              </div>
            </div>
            <div className="flex items-center gap-1 text-[10px] font-mono text-[var(--text-muted)]">
              <Users className="w-3 h-3 text-[var(--accent)]" />
              <span>3 online</span>
            </div>
          </div>

          {/* Floating Element 3: CRDT Sync Badge (Bottom Right) */}
          <div className="hidden sm:flex absolute -bottom-3 right-4 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-md py-1 px-2 shadow-xs items-center gap-1.5 text-[10px] font-mono text-[var(--text-muted)]">
            <Check className="w-3 h-3 text-[var(--accent)]" />
            <span>CRDT Converged</span>
          </div>
        </div>

        {/* 3-Dot Pagination / Slide Indicators (Directly matching reference image) */}
        <div className="flex items-center justify-center gap-2 mt-8">
          <span
            className={`transition-all duration-200 rounded-full ${
              activeDot === 0
                ? "w-6 h-1.5 bg-[var(--accent)]"
                : "w-1.5 h-1.5 bg-[var(--border-strong)] opacity-60"
            }`}
          />
          <span
            className={`transition-all duration-200 rounded-full ${
              activeDot === 1
                ? "w-6 h-1.5 bg-[var(--accent)]"
                : "w-1.5 h-1.5 bg-[var(--border-strong)] opacity-60"
            }`}
          />
          <span
            className={`transition-all duration-200 rounded-full ${
              activeDot === 2
                ? "w-6 h-1.5 bg-[var(--accent)]"
                : "w-1.5 h-1.5 bg-[var(--border-strong)] opacity-60"
            }`}
          />
        </div>
      </div>

      {/* Bottom Footer Note */}
      <div className="relative z-10 text-center">
        <span className="text-[11px] font-mono text-[var(--text-faint)]">
          CollabWorkspace Editorial Canvas · v2.4
        </span>
      </div>
    </div>
  );
}
