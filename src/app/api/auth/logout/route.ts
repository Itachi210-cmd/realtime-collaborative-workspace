import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/auth/session";
import { NO_STORE_HEADERS, verifySameOriginCsrf } from "@/lib/security/api-guard";
import { logStructured } from "@/lib/logger.mjs";

export async function POST(request: NextRequest) {
  try {
    const csrfError = verifySameOriginCsrf(request);
    if (csrfError) return csrfError;

    await clearSessionCookie();
    return NextResponse.json(
      { message: "Logged out successfully" },
      { status: 200, headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    logStructured("error", "AuthAPI", "logout_failed", { error });
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}

