import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

/**
 * Edge middleware for authentication and authorization.
 * Validates JWT tokens at the edge runtime before allowing access to protected routes.
 *
 * This catches revoked/expired sessions early and prevents unauthorized access to
 * dashboard routes at the edge (no need to execute Node.js route handlers).
 *
 * Note: Session revocation is double-checked at runtime in getSessionContext()
 * to account for the minimal timing window between edge validation and server execution.
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Public routes that don't require authentication
  const publicRoutes = [
    "/login",
    "/register",
    "/reset-password",
    "/forgot-password",
    "/api/auth",
    "/api/health",
  ];

  // Check if this is a public route
  const isPublicRoute = publicRoutes.some(
    (route) => pathname === route || pathname.startsWith(route + "/")
  );

  if (isPublicRoute) {
    return NextResponse.next();
  }

  // All other routes require authentication
  const session = await auth();

  if (!session?.user) {
    // Redirect to login if not authenticated
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Valid session exists, allow the request to proceed
  return NextResponse.next();
}

/**
 * Configuration for which routes the middleware applies to.
 * We protect all dashboard and API routes except public auth endpoints.
 */
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - /login, /register, /reset-password, /forgot-password (public auth)
     * - /api/auth/* (NextAuth endpoints)
     * - /api/health (health check)
     * - /_next/* (Next.js internals)
     * - /static/* (static files)
     * - /*.* (static files with extensions)
     */
    "/((?!login|register|reset-password|forgot-password|_next|static|.*\\.).*)",
  ],
};
