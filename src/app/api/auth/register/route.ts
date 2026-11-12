import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth/password";
import { registerSchema } from "@/lib/auth/validation";
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
      keyPrefix: "auth_register",
      limit: 15,
      windowMs: 15 * 60 * 1000,
    });
    if (rateLimited) return rateLimited;

    const parsedBody = await readJsonBody(request, 16 * 1024);
    if (!parsedBody.ok) return parsedBody.response;

    const parseResult = registerSchema.safeParse(parsedBody.data);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: "Invalid input",
          issues: parseResult.error.flatten().fieldErrors,
        },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    const { name, email, password } = parseResult.data;

    const existingUser = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (existingUser) {
      return NextResponse.json(
        { error: "An account with this email already exists." },
        { status: 409, headers: NO_STORE_HEADERS }
      );
    }

    const passwordHash = await hashPassword(password);

    const newUser = await prisma.user.create({
      data: {
        name,
        email,
        passwordHash,
      },
      select: {
        id: true,
        name: true,
        email: true,
        createdAt: true,
      },
    });

    const token = await createSessionToken({
      userId: newUser.id,
      email: newUser.email,
      name: newUser.name,
    });

    await setSessionCookie(token);

    return NextResponse.json(
      {
        message: "Registration successful",
        user: newUser,
      },
      { status: 201, headers: NO_STORE_HEADERS }
    );
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "P2002"
    ) {
      return NextResponse.json(
        { error: "An account with this email already exists." },
        { status: 409, headers: NO_STORE_HEADERS }
      );
    }
    logStructured("error", "AuthAPI", "register_failed", { error });
    return NextResponse.json(
      { error: "Internal server error. Please try again later." },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}

