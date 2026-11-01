import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

const SESSION_COOKIE_NAME = "collab_session";

function getSecretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    // Default fallback in development if env variable is somehow unloaded in Edge context
    return new TextEncoder().encode("collab-workspace-super-secret-jwt-signing-key-32-chars-min!");
  }
  return new TextEncoder().encode(secret);
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;

  let isAuthenticated = false;
  if (token) {
    try {
      const secretKey = getSecretKey();
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

  // 2. Auth routes: /login, /signup (Redirect authenticated users to /dashboard)
  const isAuthRoute = pathname === "/login" || pathname === "/signup";
  if (isAuthRoute && isAuthenticated) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
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

