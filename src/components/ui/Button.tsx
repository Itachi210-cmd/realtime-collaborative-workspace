import React from "react";
import { cn } from "@/lib/utils";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "outline" | "danger";
  size?: "sm" | "md" | "lg";
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "secondary", size = "md", children, ...props }, ref) => {
    const baseClasses =
      "inline-flex items-center justify-center font-medium rounded-md transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20 disabled:opacity-50 disabled:pointer-events-none cursor-pointer";

    const variantClasses = {
      primary:
        "bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] border border-[var(--accent)] shadow-xs",
      secondary:
        "bg-[var(--bg-raised)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)]",
      outline:
        "bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)]",
      ghost:
        "text-[var(--text-primary)] hover:bg-[var(--bg-hover)]",
      danger:
        "bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-500/20 border border-red-200 dark:border-red-500/30",
    }[variant];

    const sizeClasses = {
      sm: "text-xs px-2.5 py-1 gap-1.5 h-7",
      md: "text-sm px-3.5 py-1.5 gap-2 h-8",
      lg: "text-sm px-4 py-2 gap-2 h-9",
    }[size];

    return (
      <button
        ref={ref}
        className={cn(baseClasses, variantClasses, sizeClasses, className)}
        {...props}
      >
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";

