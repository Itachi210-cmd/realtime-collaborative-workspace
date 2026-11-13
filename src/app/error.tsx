"use client";

import React, { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCcw, Home } from "lucide-react";
import { Button } from "@/components/ui/Button";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log client error to console
    console.error("Workspace Error Boundary caught:", error);
  }, [error]);

  return (
    <div className="min-h-screen bg-[#fafafa] flex flex-col items-center justify-center p-4 text-[#37352f]">
      <div className="w-full max-w-md bg-white border border-[#e5e7eb] rounded-xl shadow-xs p-6 space-y-6 text-center">
        <div className="w-12 h-12 rounded-full bg-rose-50 border border-rose-100 flex items-center justify-center mx-auto text-rose-600">
          <AlertTriangle className="w-6 h-6" />
        </div>

        <div className="space-y-1.5">
          <h2 className="text-lg font-semibold tracking-tight text-[#37352f]">
            Something went wrong
          </h2>
          <p className="text-xs text-neutral-500 leading-relaxed">
            An unexpected error occurred while rendering this workspace view. You can retry the operation or return to the dashboard.
          </p>
          {error.message && (
            <div className="mt-2 p-2.5 rounded bg-neutral-50 border border-neutral-200 text-left font-mono text-[11px] text-neutral-600 truncate">
              {error.message}
            </div>
          )}
        </div>

        <div className="flex items-center justify-center gap-2 pt-2 border-t border-[#e9e9e7]">
          <Button variant="secondary" size="sm" onClick={() => reset()}>
            <RotateCcw className="w-3.5 h-3.5 mr-1" />
            <span>Try Again</span>
          </Button>

          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center font-medium rounded-md transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20 bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] border border-[var(--accent)] text-xs px-2.5 py-1 gap-1.5 h-7 shadow-xs cursor-pointer"
          >
            <Home className="w-3.5 h-3.5 mr-1" />
            <span>Back to Dashboard</span>
          </Link>
        </div>
      </div>
    </div>
  );
}

