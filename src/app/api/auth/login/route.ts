import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/auth/password";
import { loginSchema } from "@/lib/auth/validation";
import { createSessionToken, setSessionCookie } from "@/lib/auth/session";
import {
  NO_STORE_HEADERS,
  enforceRateLimit,
  readJsonBody,
  verifySameOriginCsrf,
} from "@/lib/security/api-guard";
import { logStructured } from "@/lib/logger.mjs";

export async function POST(request: NextRequest) {
  try {
    const csrfError = verifySameOriginCsrf(request);
    if (csrfError) return csrfError;

    const rateLimited = enforceRateLimit(request, {
      keyPrefix: "auth_login",
      limit: 20,
      windowMs: 15 * 60 * 1000,
    });
    if (rateLimited) return rateLimited;

    const parsedBody = await readJsonBody(request, 16 * 1024);
    if (!parsedBody.ok) return parsedBody.response;

    const parseResult = loginSchema.safeParse(parsedBody.data);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: "Invalid input",
          issues: parseResult.error.flatten().fieldErrors,
        },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    const { email, password } = parseResult.data;

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return NextResponse.json(
        { error: "Invalid email or password." },
        { status: 401, headers: NO_STORE_HEADERS }
      );
    }

    const isPasswordValid = await verifyPassword(password, user.passwordHash);
    if (!isPasswordValid) {
      return NextResponse.json(
        { error: "Invalid email or password." },
        { status: 401, headers: NO_STORE_HEADERS }
      );
    }

    const token = await createSessionToken({
      userId: user.id,
      email: user.email,
      name: user.name,
    });

    await setSessionCookie(token);

    return NextResponse.json(
      {
        message: "Login successful",
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
        },
      },
      { status: 200, headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    logStructured("error", "AuthAPI", "login_failed", { error });
    return NextResponse.json(
      { error: "Internal server error. Please try again later." },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}

