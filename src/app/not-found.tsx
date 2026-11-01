import React from "react";
import Link from "next/link";
import { FileQuestion, ArrowLeft, Home } from "lucide-react";
import { Button } from "@/components/ui/Button";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-[#fafafa] flex flex-col items-center justify-center p-4 text-[#37352f]">
      <div className="w-full max-w-md bg-white border border-[#e5e7eb] rounded-xl shadow-xs p-8 space-y-6 text-center">
        <div className="w-12 h-12 rounded-full bg-neutral-100 border border-neutral-200 flex items-center justify-center mx-auto text-neutral-400">
          <FileQuestion className="w-6 h-6" />
        </div>

        <div className="space-y-1.5">
          <span className="text-[11px] font-mono uppercase tracking-wider text-neutral-400">
            Error 404
          </span>
          <h1 className="text-xl font-semibold tracking-tight text-[#37352f]">
            Page or Workspace Not Found
          </h1>
          <p className="text-xs text-neutral-500 leading-relaxed max-w-sm mx-auto">
            The page you are looking for does not exist, has been deleted, or you may not have permission to view it.
          </p>
        </div>

        <div className="flex items-center justify-center gap-2 pt-2 border-t border-[#e9e9e7]">
          <Link href="/">
            <Button variant="secondary" size="sm">
              <ArrowLeft className="w-3.5 h-3.5 mr-1" />
              <span>Home</span>
            </Button>
          </Link>

          <Link href="/dashboard">
            <Button variant="primary" size="sm">
              <Home className="w-3.5 h-3.5 mr-1" />
              <span>Go to Dashboard</span>
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

