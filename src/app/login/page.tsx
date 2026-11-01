"use client";

import React from "react";
import Link from "next/link";
import { ArrowLeft, Lock } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-[#fafafa] flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white border border-[#e5e7eb] rounded-xl shadow-xs p-6 space-y-6">
        {/* Brand Header */}
        <div className="space-y-1.5 text-center">
          <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-blue-50 text-[#2383e2] mb-1">
            <Lock className="w-5 h-5" />
          </div>
          <h1 className="text-xl font-semibold text-[#37352f] tracking-tight">
            Sign in to CollabWorkspace
          </h1>
          <p className="text-xs text-neutral-500">
            Real-Time Collaborative Workspace
          </p>
        </div>

        {/* Phase 1 Notice */}
        <div className="bg-neutral-50 border border-neutral-200/80 rounded-md p-3 text-xs text-neutral-600 leading-relaxed">
          <span className="font-semibold text-neutral-800">Phase 1 Placeholder:</span> Full credential and session authentication will be implemented in <strong className="font-medium text-neutral-800">Phase 3</strong>.
        </div>

        {/* Form Fields */}
        <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
          <Input
            id="login-email"
            type="email"
            label="Email Address"
            placeholder="collab@example.com"
            disabled
          />
          <Input
            id="login-password"
            type="password"
            label="Password"
            placeholder="••••••••••••"
            disabled
          />

          <div className="pt-2">
            <Link href="/dashboard" className="w-full block">
              <Button variant="primary" className="w-full">
                Continue to Dashboard (Preview)
              </Button>
            </Link>
          </div>
        </form>

        {/* Links */}
        <div className="text-center space-y-2 pt-2 border-t border-[#e9e9e7]">
          <p className="text-xs text-neutral-500">
            Don&apos;t have an account?{" "}
            <Link href="/signup" className="text-[#2383e2] hover:underline font-medium">
              Create an account
            </Link>
          </p>
          <div>
            <Link
              href="/"
              className="inline-flex items-center gap-1 text-xs text-neutral-400 hover:text-neutral-700"
            >
              <ArrowLeft className="w-3 h-3" />
              <span>Back to home</span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
