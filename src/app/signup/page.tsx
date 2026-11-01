"use client";

import React, { useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, UserPlus, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/dashboard";

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setGeneralError(null);
    setFieldErrors({});

    // Client-side quick checks
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

      // Successful registration - route directly to callbackUrl or dashboard
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
          <UserPlus className="w-5 h-5" />
        </div>
        <h1 className="text-xl font-semibold text-[#37352f] tracking-tight">
          Create an Account
        </h1>
        <p className="text-xs text-neutral-500">
          Join the real-time collaborative workspace
        </p>
      </div>

      {generalError && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-md p-3 text-xs text-red-700">
          <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
          <span>{generalError}</span>
        </div>
      )}

      {/* Registration Form */}
      <form className="space-y-4" onSubmit={handleSubmit}>
        <Input
          id="signup-name"
          type="text"
          label="Full Name"
          placeholder="Alex Rivera"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={fieldErrors.name}
          disabled={isLoading}
          required
        />
        <Input
          id="signup-email"
          type="email"
          label="Work Email"
          placeholder="alex@workspace.dev"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={fieldErrors.email}
          disabled={isLoading}
          required
        />
        <Input
          id="signup-password"
          type="password"
          label="Choose Password"
          placeholder="Minimum 8 characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={fieldErrors.password}
          disabled={isLoading}
          required
        />
        <Input
          id="signup-confirm-password"
          type="password"
          label="Confirm Password"
          placeholder="Re-enter your password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          error={fieldErrors.confirmPassword}
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
                <span>Creating account...</span>
              </>
            ) : (
              "Create Account"
            )}
          </Button>
        </div>
      </form>

      {/* Links */}
      <div className="text-center space-y-2 pt-2 border-t border-[#e9e9e7]">
        <p className="text-xs text-neutral-500">
          Already have an account?{" "}
          <Link
            href={callbackUrl !== "/dashboard" ? `/login?callbackUrl=${encodeURIComponent(callbackUrl)}` : "/login"}
            className="text-[#2383e2] hover:underline font-medium"
          >
            Sign in
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

export default function SignupPage() {
  return (
    <div className="min-h-screen bg-[#fafafa] flex flex-col items-center justify-center p-4">
      <Suspense
        fallback={
          <div className="w-full max-w-sm bg-white border border-[#e5e7eb] rounded-xl shadow-xs p-6 text-center text-xs text-neutral-500">
            Loading...
          </div>
        }
      >
        <SignupForm />
      </Suspense>
    </div>
  );
}
