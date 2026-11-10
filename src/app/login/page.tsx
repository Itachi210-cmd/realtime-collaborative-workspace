"use client";

import React, { useState, Suspense, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, AlertCircle, Eye, EyeOff, Sun, Moon, Mail, Lock } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { AuthVisual } from "@/components/auth/AuthVisual";

const emptySubscribe = () => () => {};
const themeListeners = new Set<() => void>();
function subscribeTheme(callback: () => void) {
  themeListeners.add(callback);
  return () => {
    themeListeners.delete(callback);
  };
}

function getThemeSnapshot(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  try {
    const saved = localStorage.getItem("collab-theme") as "light" | "dark" | null;
    if (saved === "light" || saved === "dark") return saved;
    if (window.matchMedia("(prefers-color-scheme: dark)").matches) return "dark";
  } catch {}
  return "light";
}

function getServerThemeSnapshot(): "light" | "dark" {
  return "light";
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setGeneralError(null);
    setFieldErrors({});

    const errors: Record<string, string> = {};
    if (!email.trim() || !email.includes("@")) {
      errors.email = "Please enter a valid email address.";
    }
    if (!password) {
      errors.password = "Password is required.";
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          password,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 401) {
          setGeneralError(data.error || "Invalid email or password.");
        } else if (data.issues) {
          const mappedErrors: Record<string, string> = {};
          for (const [key, msgs] of Object.entries(data.issues)) {
            if (Array.isArray(msgs) && msgs.length > 0) {
              mappedErrors[key] = msgs[0];
            }
          }
          setFieldErrors(mappedErrors);
        } else {
          setGeneralError(data.error || "Failed to sign in. Please try again.");
        }
        setIsLoading(false);
        return;
      }

      router.push(callbackUrl);
      router.refresh();
    } catch {
      setGeneralError("Network connection error. Please try again.");
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-5xl mx-auto my-auto bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl sm:rounded-3xl shadow-lg overflow-hidden grid grid-cols-1 lg:grid-cols-12 min-h-[580px] relative z-10">
      {/* Left Column: Branding, Heading, Narrative & Custom Visual */}
      <div className="lg:col-span-7 h-full">
        <AuthVisual
          title="Work better, together."
          description="A quiet, real-time editorial canvas where writers, researchers, and teams craft ideas synchronously with zero distraction."
          activeDot={0}
          backHref="/"
          backLabel="Back to Home"
        />
      </div>

      {/* Right Column: Refined Login Form Card */}
      <div className="lg:col-span-5 h-full p-6 sm:p-10 lg:p-12 flex flex-col justify-center bg-[var(--bg-surface)]">
        <div className="w-full max-w-sm mx-auto space-y-6">
          {/* Header */}
          <div className="space-y-1.5">
            <div className="text-[11px] font-mono uppercase tracking-wider text-[var(--accent)] font-medium">
              Member Login
            </div>
            <h1 className="text-2xl sm:text-3xl font-serif text-[var(--text-primary)] tracking-tight">
              Welcome back
            </h1>
            <p className="text-xs text-[var(--text-muted)]">
              Sign in to continue to your workspace.
            </p>
          </div>

          {/* General Error Banner */}
          {generalError && (
            <div className="flex items-start gap-2.5 bg-red-500/10 border border-red-500/20 rounded-md p-3 text-xs text-red-600 dark:text-red-400">
              <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
              <span>{generalError}</span>
            </div>
          )}

          {/* Login Form */}
          <form className="space-y-4" onSubmit={handleSubmit} noValidate>
            {/* Email Address */}
            <div className="space-y-1.5">
              <label
                htmlFor="login-email"
                className="block text-xs font-medium text-[var(--text-muted)]"
              >
                Email address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-[var(--text-faint)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="login-email"
                  type="email"
                  placeholder="name@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isLoading}
                  autoComplete="email"
                  required
                  className="w-full pl-9 pr-3 py-2 text-xs sm:text-sm bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-md text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/15 transition-all"
                />
              </div>
              {fieldErrors.email && (
                <span className="text-[11px] text-red-600 dark:text-red-400 block pt-0.5">
                  {fieldErrors.email}
                </span>
              )}
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <label
                htmlFor="login-password"
                className="block text-xs font-medium text-[var(--text-muted)]"
              >
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-[var(--text-faint)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isLoading}
                  autoComplete="current-password"
                  required
                  className="w-full pl-9 pr-10 py-2 text-xs sm:text-sm bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-md text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/15 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)] hover:text-[var(--text-primary)] transition-colors p-0.5 cursor-pointer"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
              {fieldErrors.password && (
                <span className="text-[11px] text-red-600 dark:text-red-400 block pt-0.5">
                  {fieldErrors.password}
                </span>
              )}
            </div>

            {/* Submit Button */}
            <div className="pt-2">
              <Button
                type="submit"
                variant="primary"
                className="w-full h-10 text-xs sm:text-sm font-medium shadow-xs"
                disabled={isLoading}
              >
                {isLoading ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Signing in...</span>
                  </span>
                ) : (
                  "Sign in"
                )}
              </Button>
            </div>
          </form>

          {/* Navigation Links */}
          <div className="text-center pt-5 border-t border-[var(--border-subtle)] space-y-3">
            <p className="text-xs text-[var(--text-muted)]">
              Don&apos;t have an account?{" "}
              <Link
                href={
                  callbackUrl !== "/dashboard"
                    ? `/signup?callbackUrl=${encodeURIComponent(callbackUrl)}`
                    : "/signup"
                }
                className="text-[var(--accent)] hover:underline font-medium ml-0.5 transition-colors"
              >
                Create account
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false);
  const theme = useSyncExternalStore(subscribeTheme, getThemeSnapshot, getServerThemeSnapshot);

  const handleToggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    try {
      localStorage.setItem("collab-theme", next);
    } catch {}
    document.documentElement.setAttribute("data-theme", next);
    if (next === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    themeListeners.forEach((l) => l());
  };

  return (
    <div className="min-h-screen bg-[var(--bg-app)] flex flex-col items-center justify-center p-4 sm:p-6 lg:p-10 transition-colors duration-150 relative overflow-hidden">
      {/* Decorative Editorial Background Geometric Arcs (Inspired by reference curves) */}
      <div className="absolute -top-28 -right-28 w-96 h-96 rounded-full border border-[var(--accent)]/15 bg-[var(--accent)]/[0.02] pointer-events-none" />
      <div className="absolute -bottom-28 -left-28 w-96 h-96 rounded-full border border-[var(--border-strong)]/20 bg-[var(--bg-hover)]/20 pointer-events-none" />
      <div className="absolute -bottom-20 -right-20 w-64 h-64 rounded-full border border-[var(--accent)]/10 pointer-events-none" />

      {/* Theme Toggle in Top Right */}
      {mounted && (
        <div className="fixed top-4 right-4 z-30">
          <button
            onClick={handleToggleTheme}
            className="p-2 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-xs transition-colors cursor-pointer"
            aria-label="Toggle theme"
          >
            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      )}

      {/* Main Suspense Container */}
      <Suspense
        fallback={
          <div className="w-full max-w-md bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl shadow-xs p-8 text-center text-xs text-[var(--text-muted)] flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-[var(--accent)]" />
            <span>Loading workspace login...</span>
          </div>
        }
      >
        <LoginForm />
      </Suspense>
    </div>
  );
}
