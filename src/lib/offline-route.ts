/**
 * Should a client-side navigation to the offline shell happen right now?
 *
 * Split out from the listener in src/components/providers.tsx so the one rule
 * that must never break is testable without a DOM: a cashier standing on
 * /offline/pos with a cart on screen must NEVER be navigated away. Losing
 * connectivity there is the normal case the till was built for, and a redirect
 * would discard the in-progress sale. The same guard covers /offline itself,
 * where redirecting to /offline is a loop.
 *
 * Everything else under /dashboard is a React Server Component: with no
 * network the document request has no server to answer it and the browser
 * shows a 500 error page instead of anything useful, so we move first rather
 * than waiting for that request to fail.
 */
export function shouldNavigateToOfflineShell(pathname: string, isOffline: boolean): boolean {
  if (!isOffline) return false;
  // Trailing slash is normalised because Next will serve /offline/pos/ for the
  // same route and a string compare would otherwise miss it and redirect.
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (path === "/offline" || path.startsWith("/offline/")) return false;
  return true;
}
