/**
 * Service worker for the installed PWA.
 *
 * SCOPE, deliberately narrow: this worker caches ONLY immutable build assets
 * (/_next/static/**, which is content-hashed) and the offline fallback page.
 *
 * It never caches HTML, RSC payloads, or anything under /api. That is not an
 * oversight — every dashboard page is rendered per-session and scoped to one
 * user's store and role. A cached page is a page the NEXT person to pick up a
 * shared shop terminal can read, after a logout, without a session. The same
 * argument rules out caching /api responses, which carry stock and sales data.
 *
 * What this buys: the app opens instantly, works from the home screen, and
 * shows a real page instead of the browser's dinosaur when a navigation fails
 * offline. Live data still requires the network — `experimental.useOffline`
 * (next.config.ts) keeps those requests pending and retries them on reconnect.
 */

// Bump when the offline fallback or this file's caching rules change; the
// activate handler deletes every cache that is not in KEEP.
const VERSION = "v2";
const STATIC_CACHE = `static-${VERSION}`;
const OFFLINE_CACHE = `offline-${VERSION}`;
const KEEP = [STATIC_CACHE, OFFLINE_CACHE];
const OFFLINE_URL = "/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(OFFLINE_CACHE);
      // `reload` bypasses the HTTP cache so an install always stores the
      // freshly deployed fallback, not whatever the browser had on hand.
      await cache.add(new Request(OFFLINE_URL, { cache: "reload" }));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => !KEEP.includes(n)).map((n) => caches.delete(n)));
      await self.clients.claim();
    })()
  );
});

/** Build assets are content-hashed, so a cache hit can never be stale. */
function isImmutableAsset(url) {
  return url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/");
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never touch the API or the auth surface — see the file header.
  if (url.pathname.startsWith("/api/")) return;

  if (isImmutableAsset(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC_CACHE);
        const hit = await cache.match(request);
        if (hit) return hit;
        const response = await fetch(request);
        // Opaque/error responses are not worth storing and would be served back
        // as-is on the next load.
        if (response.ok) cache.put(request, response.clone());
        return response;
      })()
    );
    return;
  }

  // Navigations: always go to the network (fresh, session-scoped HTML), and
  // fall back to the offline page only when the network is genuinely gone.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request);
        } catch {
          const cache = await caches.open(OFFLINE_CACHE);
          return (await cache.match(OFFLINE_URL)) ?? Response.error();
        }
      })()
    );
  }
});
