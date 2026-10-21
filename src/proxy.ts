import { randomUUID } from "crypto";
import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/lib/auth.config";
import { isRouteAllowed } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { scopedLogger } from "@/lib/logger";

const { auth } = NextAuth(authConfig);
const proxyLogger = scopedLogger("system");

// "/offline" and "/offline/pos" are the service worker's navigation fallbacks
// and must never redirect: they are only ever reached with no network, and both
// the /login redirect and the signed-in /dashboard redirect would need one to
// resolve. The prefix below covers every current and future /offline/* shell.
const PUBLIC_PATHS = ["/login", "/forgot-password", "/reset-password", "/offline"];
const OFFLINE_PREFIX = "/offline";

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
  // Route Handlers under /api never reach Proxy (the matcher excludes "api"),
  // so their logs simply carry no `requestId` — `getRequestId()` returns null
  // rather than failing.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-request-id", randomUUID());
  const next = () => NextResponse.next({ request: { headers: requestHeaders } });

  // Every /offline/* page is a precached static shell, so it must short-circuit
  // BEFORE the revocation lookup below: that query needs the database, which is
  // exactly what the device does not have when it lands here. Reaching Prisma
  // offline turns the fallback into a hung request and the till shows nothing.
  // These pages carry no session data of their own (see src/app/offline/pos),
  // so skipping the check costs nothing — the lease and the server-side check
  // at sync time (src/lib/offline/lease-server.ts) are what actually gate
  // offline selling.
  if (nextUrl.pathname === OFFLINE_PREFIX || nextUrl.pathname.startsWith(`${OFFLINE_PREFIX}/`)) {
    return next();
  }

  // SECURITY: Check if the user account is still active (not deactivated/terminated).
  // This ensures deactivated employees lose access immediately, not just at session expiry.
  if (isLoggedIn && userId) {
    let user: { status: string } | null;
    try {
      user = await prisma.user.findUnique({
        where: { id: userId },
        select: { status: true },
      });
    } catch (error) {
      // The database is unreachable: a till that lost its connection mid-shift,
      // or Neon being down. Previously this threw out of the proxy and every
      // page in the app became a runtime error overlay, including the offline
      // shells that exist precisely for this moment.
      //
      // Fail OPEN here, deliberately, and only here. The cost is that a user
      // deactivated during an outage keeps their session until the database
      // answers again, bounded by the 24h JWT. The alternative is failing
      // closed, which locks every cashier out of a working till the instant
      // the network blinks -- a far more likely event than a revocation
      // landing inside that window. Every write path still re-checks the
      // session server-side and cannot run without the database anyway, so
      // this gate is not the last line of defence.
      proxyLogger.warn(
        { err: error, userId, path: nextUrl.pathname },
        "revocation check skipped: database unreachable"
      );
      return next();
    }
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
  // `sw.js` and `manifest.webmanifest` must be excluded: the browser fetches
  // both WITHOUT credentials, so anything auth-gated answers them with a 302 to
  // /login and the PWA silently fails to install or register its worker.
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|sw\\.js|manifest\\.webmanifest|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
