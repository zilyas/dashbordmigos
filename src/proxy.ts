import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";
import { isRouteAllowed } from "@/lib/rbac";

const { auth } = NextAuth(authConfig);

const PUBLIC_PATHS = ["/login", "/forgot-password", "/reset-password"];

export default auth((req) => {
  const { nextUrl } = req;
  const isLoggedIn = !!req.auth?.user;
  const role = req.auth?.user?.role;
  const isPublicPath = PUBLIC_PATHS.some((p) => nextUrl.pathname.startsWith(p));

  // Server Action invocations are POSTs to the current page carrying a
  // `next-action` header. Redirecting these from Proxy (a raw HTTP
  // redirect) breaks the client's action fetch contract and surfaces as
  // "An unexpected response was received from the server." Let these
  // through — every action already re-checks auth/permissions itself via
  // `getSessionContext()`/`can()` and returns a normal `{ error }` result
  // (or a session-less redirect from `auth()`) instead of crashing.
  if (req.headers.get("next-action")) {
    return;
  }

  if (isPublicPath) {
    if (isLoggedIn) {
      return Response.redirect(new URL("/dashboard", nextUrl));
    }
    return;
  }

  if (!isLoggedIn) {
    const loginUrl = new URL("/login", nextUrl);
    loginUrl.searchParams.set("callbackUrl", nextUrl.pathname);
    return Response.redirect(loginUrl);
  }

  if (role && !isRouteAllowed(nextUrl.pathname, role)) {
    return Response.redirect(new URL("/dashboard", nextUrl));
  }
});

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
