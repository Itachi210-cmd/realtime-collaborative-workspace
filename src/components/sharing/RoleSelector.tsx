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
          "appearance-none bg-white border border-[#e5e7eb] rounded-md font-medium text-[#37352f] transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-[#2383e2] disabled:opacity-60 disabled:cursor-not-allowed hover:bg-[#fafafa]",
          sizeClasses,
          showIcon ? "pl-7" : "pl-2.5"
        )}
        aria-label="Select member role"
      >
        <option value="EDITOR">Editor</option>
        <option value="COMMENTER">Commenter</option>
        <option value="VIEWER">Viewer</option>
      </select>
      <ChevronDown className="w-3 h-3 text-neutral-400 absolute right-2 pointer-events-none" />
    </div>
  );
}

