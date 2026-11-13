import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession, clearSessionCookie } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { updateProfileSchema } from "@/lib/validations/profile";
import {
  NO_STORE_HEADERS,
  enforceRateLimit,
  readJsonBody,
  verifySameOriginCsrf,
} from "@/lib/security/api-guard";
import { logStructured } from "@/lib/logger.mjs";

/**
 * GET /api/auth/me
 * Retrieves current authenticated user profile.
 */
export async function GET(request?: NextRequest) {
  try {
    const session = await getCurrentSession(request);
    if (!session) {
      try {
        await clearSessionCookie();
      } catch {}
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: NO_STORE_HEADERS }
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: {
        id: true,
        name: true,
        email: true,
        createdAt: true,
      },
    });

    if (!user) {
      try {
        await clearSessionCookie();
      } catch {}
      return NextResponse.json(
        { error: "User no longer exists" },
        { status: 401, headers: NO_STORE_HEADERS }
      );
    }

    return NextResponse.json(
      { user },
      { status: 200, headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    logStructured("error", "AuthAPI", "me_failed", { error });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}

/**
 * PATCH /api/auth/me
 * Updates current authenticated user's name and/or password.
 * Strictly verifies current password before updating passwordHash.
 * Email updates are deliberately forbidden.
 */
export async function PATCH(request: NextRequest) {
  try {
    // 1. Defense-in-depth CSRF verification
    const csrfError = verifySameOriginCsrf(request);
    if (csrfError) return csrfError;

    // 2. Authentication check
    const session = await getCurrentSession(request);
    if (!session) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: NO_STORE_HEADERS }
      );
    }

    // 3. Rate limiting per user
    const rateLimited = enforceRateLimit(request, {
      keyPrefix: "profile_update",
      limit: 20,
      windowMs: 60_000,
      identifier: session.userId,
    });
    if (rateLimited) return rateLimited;

    // 4. Parse JSON body (bounded to 16KB)
    const parsedBody = await readJsonBody(request, 16 * 1024);
    if (!parsedBody.ok) return parsedBody.response;

    // 5. Validate input payload with Zod schema
    const parseResult = updateProfileSchema.safeParse(parsedBody.data);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: "Invalid input",
          issues: parseResult.error.flatten().fieldErrors,
        },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    const { name, currentPassword, newPassword } = parseResult.data;
    const updateData: { name: string; passwordHash?: string } = {
      name,
    };

    // 6. If password change is requested, verify current password first
    if (newPassword && newPassword.trim().length > 0) {
      const existingUser = await prisma.user.findUnique({
        where: { id: session.userId },
        select: { passwordHash: true },
      });

      if (!existingUser) {
        return NextResponse.json(
          { error: "User no longer exists" },
          { status: 401, headers: NO_STORE_HEADERS }
        );
      }

      if (!currentPassword) {
        return NextResponse.json(
          { error: "Current password is required to change your password." },
          { status: 400, headers: NO_STORE_HEADERS }
        );
      }

      const isCurrentPasswordValid = await verifyPassword(
        currentPassword,
        existingUser.passwordHash
      );

      if (!isCurrentPasswordValid) {
        return NextResponse.json(
          { error: "Incorrect current password." },
          { status: 400, headers: NO_STORE_HEADERS }
        );
      }

      const newHash = await hashPassword(newPassword);
      updateData.passwordHash = newHash;
    }

    // 7. Update user profile in database
    const updatedUser = await prisma.user.update({
      where: { id: session.userId },
      data: updateData,
      select: {
        id: true,
        name: true,
        email: true,
        createdAt: true,
      },
    });

    return NextResponse.json(
      {
        message: "Profile updated successfully",
        user: updatedUser,
      },
      { status: 200, headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    logStructured("error", "AuthAPI", "profile_update_failed", { error });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
