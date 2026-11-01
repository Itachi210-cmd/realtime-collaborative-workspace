import React from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Skeleton } from "@/components/ui/Skeleton";

export default function WorkspaceLoading() {
  return (
    <AppShell pageTitle="Loading Document...">
      <div className="space-y-6 animate-in fade-in duration-150">
        {/* Toolbar Skeleton */}
        <div className="h-9 w-full bg-[#fbfbfa] border border-[#e9e9e7] rounded-md flex items-center gap-2 px-3">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-24" />
          <div className="ml-auto flex gap-2">
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-4 w-12" />
          </div>
        </div>

        {/* Document Header Skeleton */}
        <div className="pt-6 pb-2 space-y-4">
          <Skeleton className="h-10 w-10 rounded-md" />
          <Skeleton className="h-10 w-3/4 max-w-md" />
          <div className="flex gap-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-20" />
          </div>
        </div>

        {/* Document Body Skeletons */}
        <div className="space-y-3 pt-4">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-4/5" />
          <div className="py-2">
            <Skeleton className="h-20 w-full rounded-md" />
          </div>
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </div>
    </AppShell>
  );
}

