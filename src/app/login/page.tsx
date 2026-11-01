"use client";

import React, { useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Lock, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

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

      // Successful login - route directly to callbackUrl or dashboard
      router.push(callbackUrl);
      router.refresh();
    } catch {
      setGeneralError("Network connection error. Please try again.");
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-sm bg-white border border-[#e5e7eb] rounded-xl shadow-xs p-6 space-y-6">
      {/* Brand Header */}
      <div className="space-y-1.5 text-center">
        <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-blue-50 text-[#2383e2] mb-1">
          <Lock className="w-5 h-5" />
        </div>
        <h1 className="text-xl font-semibold text-[#37352f] tracking-tight">
          Sign in to CollabWorkspace
        </h1>
        <p className="text-xs text-neutral-500">
          Real-Time Collaborative Workspace
        </p>
      </div>

      {generalError && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-md p-3 text-xs text-red-700">
          <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
          <span>{generalError}</span>
        </div>
      )}

      {/* Login Form */}
      <form className="space-y-4" onSubmit={handleSubmit}>
        <Input
          id="login-email"
          type="email"
          label="Email Address"
          placeholder="collab@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={fieldErrors.email}
          disabled={isLoading}
          required
        />
        <Input
          id="login-password"
          type="password"
          label="Password"
          placeholder="••••••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={fieldErrors.password}
          disabled={isLoading}
          required
        />

        <div className="pt-2">
          <Button
            type="submit"
            variant="primary"
            className="w-full flex items-center justify-center gap-2"
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Signing in...</span>
              </>
            ) : (
              "Sign In"
            )}
          </Button>
        </div>
      </form>

      {/* Links */}
      <div className="text-center space-y-2 pt-2 border-t border-[#e9e9e7]">
        <p className="text-xs text-neutral-500">
          Don&apos;t have an account?{" "}
          <Link
            href={callbackUrl !== "/dashboard" ? `/signup?callbackUrl=${encodeURIComponent(callbackUrl)}` : "/signup"}
            className="text-[#2383e2] hover:underline font-medium"
          >
            Create an account
          </Link>
        </p>
        <div>
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-xs text-neutral-400 hover:text-neutral-700"
          >
            <ArrowLeft className="w-3 h-3" />
            <span>Back to home</span>
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-[#fafafa] flex flex-col items-center justify-center p-4">
      <Suspense
        fallback={
          <div className="w-full max-w-sm bg-white border border-[#e5e7eb] rounded-xl shadow-xs p-6 text-center text-xs text-neutral-500">
            Loading...
          </div>
        }
      >
        <LoginForm />
      </Suspense>
    </div>
  );
}
