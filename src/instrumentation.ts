/**
 * Next.js Server Startup Instrumentation
 * Real-Time Collaborative Workspace - Phase 12 Step 2
 *
 * Validates required server environment variables and secrets once upon
 * Node.js server boot. Skipped during `next build` so container builds can
 * occur before runtime secrets are injected.
 */
export async function register() {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NEXT_PHASE !== "phase-production-build"
  ) {
    const { validateRuntimeEnv } = await import("@/lib/env.mjs");
    const result = validateRuntimeEnv({
      target: "next",
      throwOnError: true,
    });

    for (const warning of result.warnings) {
      console.warn(`[NextStartupEnv] Warning: ${warning}`);
    }
  }
}

