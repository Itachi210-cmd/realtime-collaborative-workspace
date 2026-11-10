"use client";

import React from "react";
import { ChevronDown, ShieldCheck, MessageSquare, Eye } from "lucide-react";
import { cn } from "@/lib/utils";

export type SelectableRole = "EDITOR" | "COMMENTER" | "VIEWER";

interface RoleSelectorProps {
  value: SelectableRole;
  onChange: (newRole: SelectableRole) => void;
  disabled?: boolean;
  className?: string;
  size?: "sm" | "md";
  showIcon?: boolean;
}

export function RoleSelector({
  value,
  onChange,
  disabled = false,
  className,
  size = "sm",
  showIcon = true,
}: RoleSelectorProps) {
  const getRoleIcon = (role: SelectableRole) => {
    switch (role) {
      case "EDITOR":
        return <ShieldCheck className="w-3.5 h-3.5 text-blue-600 shrink-0" />;
      case "COMMENTER":
        return <MessageSquare className="w-3.5 h-3.5 text-amber-600 shrink-0" />;
      case "VIEWER":
        return <Eye className="w-3.5 h-3.5 text-neutral-500 shrink-0" />;
    }
  };

  const sizeClasses = {
    sm: "text-xs py-1 pl-2.5 pr-7 h-7",
    md: "text-sm py-1.5 pl-3 pr-8 h-8",
  }[size];

  return (
    <div className={cn("relative inline-flex items-center", className)}>
      {showIcon && (
        <div className="absolute left-2.5 pointer-events-none z-10">
          {getRoleIcon(value)}
        </div>
      )}
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as SelectableRole)}
        className={cn(
          "appearance-none bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-md font-medium text-[var(--text-primary)] transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20 focus:border-[var(--accent)] disabled:opacity-60 disabled:cursor-not-allowed hover:bg-[var(--bg-hover)]",
          sizeClasses,
          showIcon ? "pl-7" : "pl-2.5"
        )}
        aria-label="Select member role"
      >
        <option value="EDITOR" className="bg-[var(--bg-surface)] text-[var(--text-primary)]">Editor</option>
        <option value="COMMENTER" className="bg-[var(--bg-surface)] text-[var(--text-primary)]">Commenter</option>
        <option value="VIEWER" className="bg-[var(--bg-surface)] text-[var(--text-primary)]">Viewer</option>
      </select>
      <ChevronDown className="w-3 h-3 text-[var(--text-faint)] absolute right-2 pointer-events-none" />
    </div>
  );
}

