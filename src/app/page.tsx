import React from "react";
import Link from "next/link";
import {
  FileText,
  LayoutDashboard,
  LogIn,
  UserPlus,
  ArrowRight,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/Button";

export default function HomePage() {
  const routes = [
    {
      title: "Workspace Dashboard",
      path: "/dashboard",
      description: "Manage workspaces, recent documents, search, and member roles.",
      icon: LayoutDashboard,
      badge: "Core UI Shell",
    },
    {
      title: "Document Canvas",
      path: "/workspace/ws-main",
      description: "Editor shell, toolbar, presence avatars, and document layout.",
      icon: FileText,
      badge: "Editor Route",
    },
    {
      title: "Sign In",
      path: "/login",
      description: "User authentication gateway (credentials and sessions).",
      icon: LogIn,
      badge: "Auth Route",
    },
    {
      title: "Create Account",
      path: "/signup",
      description: "Registration entry point for new workspace team members.",
      icon: UserPlus,
      badge: "Auth Route",
    },
  ];

  const techStack = [
    { name: "Next.js (App Router)", category: "Frontend & API" },
    { name: "TypeScript", category: "Type Safety" },
    { name: "Tailwind CSS", category: "Notion Minimal Design" },
    { name: "PostgreSQL & Prisma", category: "Relational Persistence" },
    { name: "Yjs (CRDT)", category: "Conflict-Free Sync" },
    { name: "y-websocket", category: "Real-Time Transport" },
    { name: "Redis", category: "Multi-Instance Scaling" },
    { name: "TipTap", category: "Rich-Text Engine" },
  ];

  return (
    <div className="min-h-screen bg-white text-[#37352f] flex flex-col">
      {/* Top Bar */}
      <header className="h-14 border-b border-[#e9e9e7] px-6 flex items-center justify-between bg-white/80 backdrop-blur-xs sticky top-0 z-20">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-md bg-[#2383e2] text-white flex items-center justify-center font-bold text-xs">
            W
          </div>
          <span className="font-semibold text-sm tracking-tight text-[#37352f]">
            CollabWorkspace
          </span>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-neutral-100 text-neutral-600 border border-neutral-200">
            Phase 1
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Link href="/login">
            <Button variant="ghost" size="sm">
              Sign In
            </Button>
          </Link>
          <Link href="/dashboard">
            <Button variant="primary" size="sm">
              Open App Shell
            </Button>
          </Link>
        </div>
      </header>

      {/* Hero Section */}
      <main className="flex-1 max-w-4xl mx-auto w-full px-6 py-12 space-y-12">
        <div className="space-y-4 text-center sm:text-left">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-50 border border-blue-100 text-[#2383e2] text-xs font-medium">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Internship Project Blueprint Implementation</span>
          </div>
          <h1 className="text-3xl sm:text-5xl font-bold tracking-tight text-[#37352f] leading-tight">
            Real-Time Collaborative Workspace
          </h1>
          <p className="text-base sm:text-lg text-neutral-600 max-w-2xl leading-relaxed">
            A Notion/Figma-inspired collaborative workspace featuring CRDT-based rich-text editing, live presence indicators, role-based access control, and PostgreSQL persistence.
          </p>
        </div>

        {/* Phase 1 Verification Routes Grid */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">
              Phase 1 Placeholder Routes
            </h2>
            <span className="text-xs text-neutral-400">All 4 routes verified &amp; navigable</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {routes.map((route) => {
              const Icon = route.icon;
              return (
                <Link
                  key={route.path}
                  href={route.path}
                  className="group p-5 bg-[#fafafa]/50 hover:bg-white border border-[#e9e9e7] hover:border-[#2383e2]/40 rounded-xl transition-all shadow-xs hover:shadow-sm flex flex-col justify-between space-y-4"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="w-8 h-8 rounded-lg bg-white border border-[#e5e7eb] flex items-center justify-center text-[#2383e2]">
                        <Icon className="w-4 h-4" />
                      </div>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white border border-neutral-200 text-neutral-500">
                        {route.badge}
                      </span>
                    </div>
                    <h3 className="text-sm font-semibold text-[#37352f] group-hover:text-[#2383e2] transition-colors">
                      {route.title}
                    </h3>
                    <p className="text-xs text-neutral-500 leading-relaxed">
                      {route.description}
                    </p>
                  </div>

                  <div className="flex items-center justify-between text-xs font-medium text-neutral-500 group-hover:text-[#2383e2] pt-2 border-t border-[#e9e9e7]/50">
                    <span className="font-mono text-[11px]">{route.path}</span>
                    <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
                  </div>
                </Link>
              );
            })}
          </div>
        </div>

        {/* Technology Stack Grid */}
        <div className="space-y-4 pt-4 border-t border-[#e9e9e7]">
          <h2 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">
            Mandatory Technology Stack (₹0 Budget Target)
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {techStack.map((tech) => (
              <div
                key={tech.name}
                className="p-3 bg-white border border-[#e9e9e7] rounded-lg space-y-1"
              >
                <span className="text-[10px] text-neutral-400 block font-mono">
                  {tech.category}
                </span>
                <span className="text-xs font-semibold text-[#37352f] block">
                  {tech.name}
                </span>
              </div>
            ))}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-[#e9e9e7] py-6 px-6 text-center text-xs text-neutral-400">
        Real-Time Collaborative Workspace • Built strictly to blueprint specifications
      </footer>
    </div>
  );
}
