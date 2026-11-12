"use client";

import React, { useState, Suspense, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, AlertCircle, Eye, EyeOff, Sun, Moon, Mail, Lock, User } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { AuthVisual } from "@/components/auth/AuthVisual";
import { sanitizeCallbackUrl } from "@/lib/security/api-guard";

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

function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = sanitizeCallbackUrl(searchParams.get("callbackUrl"));

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setGeneralError(null);
    setFieldErrors({});

    const errors: Record<string, string> = {};
    if (!name.trim() || name.trim().length < 2) {
      errors.name = "Full name must be at least 2 characters.";
    }
    if (!email.trim() || !email.includes("@")) {
      errors.email = "Please enter a valid email address.";
    }
    if (!password || password.length < 8) {
      errors.password = "Password must be at least 8 characters.";
    }
    if (password !== confirmPassword) {
      errors.confirmPassword = "Passwords do not match.";
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          password,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 409) {
          setGeneralError(data.error || "An account with this email already exists.");
        } else if (data.issues) {
          const mappedErrors: Record<string, string> = {};
          for (const [key, msgs] of Object.entries(data.issues)) {
            if (Array.isArray(msgs) && msgs.length > 0) {
              mappedErrors[key] = msgs[0];
            }
          }
          setFieldErrors(mappedErrors);
        } else {
          setGeneralError(data.error || "Failed to create account. Please try again.");
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
          title="Craft ideas, collectively."
          description="Join your team in a distraction-free editorial environment designed for real-time writing, feedback, and publishing."
          activeDot={1}
          backHref="/"
          backLabel="Back to Home"
        />
      </div>

      {/* Right Column: Refined Signup Form Card */}
      <div className="lg:col-span-5 h-full p-6 sm:p-10 lg:p-12 flex flex-col justify-center bg-[var(--bg-surface)]">
        <div className="w-full max-w-sm mx-auto space-y-5">
          {/* Header */}
          <div className="space-y-1">
            <div className="text-[11px] font-mono uppercase tracking-wider text-[var(--accent)] font-medium">
              New Account
            </div>
            <h1 className="text-2xl sm:text-3xl font-serif text-[var(--text-primary)] tracking-tight">
              Get started
            </h1>
            <p className="text-xs text-[var(--text-muted)]">
              Create your collaborative workspace account.
            </p>
          </div>

          {/* General Error Banner */}
          {generalError && (
            <div className="flex items-start gap-2.5 bg-red-500/10 border border-red-500/20 rounded-md p-3 text-xs text-red-600 dark:text-red-400">
              <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
              <span>{generalError}</span>
            </div>
          )}

          {/* Registration Form */}
          <form className="space-y-3.5" onSubmit={handleSubmit} noValidate>
            {/* Full Name */}
            <div className="space-y-1">
              <label
                htmlFor="signup-name"
                className="block text-xs font-medium text-[var(--text-muted)]"
              >
                Full name
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-[var(--text-faint)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="signup-name"
                  type="text"
                  placeholder="Elena Vance"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={isLoading}
                  autoComplete="name"
                  required
                  className="w-full pl-9 pr-3 py-1.5 text-xs sm:text-sm bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-md text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/15 transition-all"
                />
              </div>
              {fieldErrors.name && (
                <span className="text-[11px] text-red-600 dark:text-red-400 block pt-0.5">
                  {fieldErrors.name}
                </span>
              )}
            </div>

            {/* Email Address */}
            <div className="space-y-1">
              <label
                htmlFor="signup-email"
                className="block text-xs font-medium text-[var(--text-muted)]"
              >
                Email address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-[var(--text-faint)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="signup-email"
                  type="email"
                  placeholder="name@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isLoading}
                  autoComplete="email"
                  required
                  className="w-full pl-9 pr-3 py-1.5 text-xs sm:text-sm bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-md text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/15 transition-all"
                />
              </div>
              {fieldErrors.email && (
                <span className="text-[11px] text-red-600 dark:text-red-400 block pt-0.5">
                  {fieldErrors.email}
                </span>
              )}
            </div>

            {/* Password */}
            <div className="space-y-1">
              <label
                htmlFor="signup-password"
                className="block text-xs font-medium text-[var(--text-muted)]"
              >
                Password (min. 8 characters)
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-[var(--text-faint)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="signup-password"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isLoading}
                  autoComplete="new-password"
                  required
                  className="w-full pl-9 pr-10 py-1.5 text-xs sm:text-sm bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-md text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/15 transition-all"
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

            {/* Confirm Password */}
            <div className="space-y-1">
              <label
                htmlFor="signup-confirm-password"
                className="block text-xs font-medium text-[var(--text-muted)]"
              >
                Confirm password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-[var(--text-faint)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="signup-confirm-password"
                  type={showConfirmPassword ? "text" : "password"}
                  placeholder="••••••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={isLoading}
                  autoComplete="new-password"
                  required
                  className="w-full pl-9 pr-10 py-1.5 text-xs sm:text-sm bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-md text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/15 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)] hover:text-[var(--text-primary)] transition-colors p-0.5 cursor-pointer"
                  aria-label={showConfirmPassword ? "Hide confirm password" : "Show confirm password"}
                >
                  {showConfirmPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
              {fieldErrors.confirmPassword && (
                <span className="text-[11px] text-red-600 dark:text-red-400 block pt-0.5">
                  {fieldErrors.confirmPassword}
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
                    <span>Creating account...</span>
                  </span>
                ) : (
                  "Create account"
                )}
              </Button>
            </div>
          </form>

          {/* Navigation Links */}
          <div className="text-center pt-4 border-t border-[var(--border-subtle)]">
            <p className="text-xs text-[var(--text-muted)]">
              Already have an account?{" "}
              <Link
                href={
                  callbackUrl !== "/dashboard"
                    ? `/login?callbackUrl=${encodeURIComponent(callbackUrl)}`
                    : "/login"
                }
                className="text-[var(--accent)] hover:underline font-medium ml-0.5 transition-colors"
              >
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SignupPage() {
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
      {/* Decorative Editorial Background Geometric Arcs (Matching Login) */}
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
            <span>Loading registration...</span>
          </div>
        }
      >
        <SignupForm />
      </Suspense>
    </div>
  );
}
