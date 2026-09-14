import { randomUUID } from "crypto";
import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/lib/auth.config";
import { isRouteAllowed } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

const { auth } = NextAuth(authConfig);

const PUBLIC_PATHS = ["/login", "/forgot-password", "/reset-password"];

export default auth(async (req) => {
  const { nextUrl } = req;
  const isLoggedIn = !!req.auth?.user;
  const role = req.auth?.user?.role;
  const userId = req.auth?.user?.id;
  const isPublicPath = PUBLIC_PATHS.some((p) => nextUrl.pathname.startsWith(p));

  // Stamp every request that reaches app code with a correlation ID, so
  // `logServerError` (src/lib/logger.ts) can read it back via next/headers()
  // in Server Actions / Server Components and group one request's log lines.
  // Proxy is Node runtime here (see AGENTS.md), so `crypto.randomUUID` is safe.
  // Route Handlers under /api never reach Proxy (matcher excludes "api") —
  // they generate their own ID instead (see src/app/api/cron/backup/route.ts).
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-request-id", randomUUID());
  const next = () => NextResponse.next({ request: { headers: requestHeaders } });

  // SECURITY: Check if the user account is still active (not deactivated/terminated).
  // This ensures deactivated employees lose access immediately, not just at session expiry.
  if (isLoggedIn && userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { status: true },
    });
    // If user is not found or not active, redirect to login
    if (!user || user.status !== "ACTIVE") {
      const loginUrl = new URL("/login", nextUrl);
      loginUrl.searchParams.set("callbackUrl", nextUrl.pathname);
      return Response.redirect(loginUrl);
    }
  }

  // Server Action invocations are POSTs to the current page carrying a
  // `next-action` header. Redirecting these from Proxy (a raw HTTP
  // redirect) breaks the client's action fetch contract and surfaces as
  // "An unexpected response was received from the server." Let these
  // through — every action already re-checks auth/permissions itself via
  // `getSessionContext()`/`can()` and returns a normal `{ error }` result
  // (or a session-less redirect from `auth()`) instead of crashing.
  if (req.headers.get("next-action")) {
    return next();
  }

  if (isPublicPath) {
    if (isLoggedIn) {
      return Response.redirect(new URL("/dashboard", nextUrl));
    }
    return next();
  }

  if (!isLoggedIn) {
    const loginUrl = new URL("/login", nextUrl);
    loginUrl.searchParams.set("callbackUrl", nextUrl.pathname);
    return Response.redirect(loginUrl);
  }

  if (role && !isRouteAllowed(nextUrl.pathname, role)) {
    return Response.redirect(new URL("/dashboard", nextUrl));
  }

  return next();
});

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
