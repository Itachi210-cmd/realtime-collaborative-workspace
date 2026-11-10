"use client";

import React, { createContext, useContext, useState, useCallback } from "react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type ToastVariant = "success" | "error" | "info";

export interface ToastItem {
  id: string;
  message: string;
  description?: string;
  variant?: ToastVariant;
  duration?: number;
}

interface ToastContextType {
  toasts: ToastItem[];
  addToast: (toast: Omit<ToastItem, "id">) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback(
    ({ message, description, variant = "info", duration = 4000 }: Omit<ToastItem, "id">) => {
      const id = Math.random().toString(36).substring(2, 9);
      const newToast: ToastItem = { id, message, description, variant, duration };

      setToasts((prev) => [...prev, newToast]);

      if (duration > 0) {
        setTimeout(() => {
          removeToast(id);
        }, duration);
      }
    },
    [removeToast]
  );

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}

function ToastContainer({
  toasts,
  onRemove,
}: {
  toasts: ToastItem[];
  onRemove: (id: string) => void;
}) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onRemove={() => onRemove(toast.id)} />
      ))}
    </div>
  );
}

export function ToastCard({
  toast,
  onRemove,
}: {
  toast: ToastItem;
  onRemove: () => void;
}) {
  const icons = {
    success: <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />,
    error: <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />,
    info: <Info className="w-4 h-4 text-[var(--accent)] shrink-0 mt-0.5" />,
  };

  const borderStyles = {
    success: "border-emerald-500/30 bg-[var(--bg-surface)]",
    error: "border-rose-500/30 bg-[var(--bg-surface)]",
    info: "border-[var(--border-subtle)] bg-[var(--bg-surface)]",
  }[toast.variant || "info"];

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "pointer-events-auto p-3.5 rounded-lg border shadow-md flex items-start gap-2.5 text-[var(--text-primary)] transition-all duration-200",
        borderStyles
      )}
    >
      {icons[toast.variant || "info"]}

      <div className="flex-1 min-w-0 pr-1">
        <p className="text-xs font-semibold text-[var(--text-primary)] leading-snug">{toast.message}</p>
        {toast.description && (
          <p className="text-[11px] text-[var(--text-muted)] mt-0.5 leading-normal">
            {toast.description}
          </p>
        )}
      </div>

      <button
        onClick={onRemove}
        className="p-1 rounded text-[var(--text-faint)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] shrink-0 transition-colors cursor-pointer"
        aria-label="Dismiss toast"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

