import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { getAuthSecretKey } from "@/lib/env.mjs";

const SESSION_COOKIE_NAME = "collab_session";

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;

  let secretKey: Uint8Array;
  try {
    secretKey = getAuthSecretKey();
  } catch (err) {
    console.error(
      "[Middleware] Authentication configuration error:",
      err instanceof Error ? err.message : "Invalid AUTH_SECRET"
    );
    return new NextResponse("Server authentication configuration error.", {
      status: 500,
    });
  }

  let isAuthenticated = false;
  if (token) {
    try {
      await jwtVerify(token, secretKey, {
        algorithms: ["HS256"],
      });
      isAuthenticated = true;
    } catch {
      isAuthenticated = false;
    }
  }

  // 1. Protected routes: /dashboard, /workspace
  const isProtectedRoute =
    pathname.startsWith("/dashboard") || pathname.startsWith("/workspace");

  if (isProtectedRoute && !isAuthenticated) {
    const callbackUrl = encodeURIComponent(`${pathname}${search}`);
    const loginUrl = new URL(`/login?callbackUrl=${callbackUrl}`, request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - api routes (/api/*)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, sitemap.xml, robots.txt (metadata files)
     */
    "/((?!api|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};

