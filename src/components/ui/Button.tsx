import React from "react";
import { cn } from "@/lib/utils";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "outline" | "danger";
  size?: "sm" | "md" | "lg";
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "secondary", size = "md", children, ...props }, ref) => {
    const baseClasses =
      "inline-flex items-center justify-center font-medium rounded-md transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:opacity-50 disabled:pointer-events-none cursor-pointer";

    const variantClasses = {
      primary: "bg-[#2383e2] text-white hover:bg-[#1d6fc2] border border-[#2383e2] shadow-xs",
      secondary: "bg-[#f7f7f5] text-[#37352f] hover:bg-[#efefed] border border-[#e9e9e7]",
      outline: "bg-white text-[#37352f] hover:bg-[#f7f7f5] border border-[#e9e9e7]",
      ghost: "text-[#37352f] hover:bg-[#efefed]",
      danger: "bg-red-50 text-red-600 hover:bg-red-100 border border-red-200",
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

