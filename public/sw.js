/**
 * Service worker for the installed PWA.
 *
 * SCOPE, deliberately narrow: this worker caches ONLY immutable build assets
 * (/_next/static/**, which is content-hashed) and one fully static offline
 * page, /offline/pos.
 *
 * It never caches any other HTML, any RSC payload, or anything under /api.
 * That is not an oversight — every dashboard page is rendered per-session and
 * scoped to one user's store and role. A cached page is a page the NEXT person
 * to pick up a shared shop terminal can read, after a logout, without a
 * session. The same argument rules out caching /api responses, which carry
 * stock and sales data.
 *
 * /offline/pos is the ONLY addition to that list, and only because it contains
 * nothing of any user: it is prerendered at build time (`next build` must show
 * it as `○`), and everything the till displays is read from IndexedDB in the
 * browser after it mounts. Do not extend this exception to a page that renders
 * server data — the rule above is a security boundary, not a cache-tuning knob.
 *
 * What this buys: the app opens instantly, works from the home screen, and
 * shows a real page instead of the browser's dinosaur when a navigation fails
 * offline. Live data still requires the network — `experimental.useOffline`
 * (next.config.ts) keeps those requests pending and retries them on reconnect.
 */

// Bump when the offline fallback or this file's caching rules change; the
// activate handler deletes every cache that is not in KEEP.
// v5: dropped the separate /offline home shell. /offline/pos is now the only
// offline page and the fallback for every failed navigation. Bumping this is
// not optional — the activate handler only drops caches outside KEEP, so an
// unbumped version leaves every already-installed till serving the previous
// deploy's shell until someone clears site data.
const VERSION = "v5";
const STATIC_CACHE = `static-${VERSION}`;
const OFFLINE_CACHE = `offline-${VERSION}`;
const KEEP = [STATIC_CACHE, OFFLINE_CACHE];
const OFFLINE_POS_URL = "/offline/pos";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(OFFLINE_CACHE);
      // `reload` bypasses the HTTP cache so an install always stores the
      // freshly deployed fallbacks, not whatever the browser had on hand.
      await cache.add(new Request(OFFLINE_POS_URL, { cache: "reload" }));
      // The till's own JS/CSS have to be here too. A navigation served from the
      // precache still asks for its /_next/static chunks, and on a cold offline
      // start nothing has ever fetched them, so the shell would hydrate into
      // nothing. The asset URLs are content-hashed per deploy and therefore not
      // knowable from this file — read them out of the HTML we just stored.
      await precachePosAssets(cache);
      await self.skipWaiting();
    })()
  );
});

/**
 * Pull the /_next/static URLs out of the stored /offline/pos HTML and warm the
 * static cache with them. Best effort: a failure here costs styling on a cold
 * offline start, so it must never reject and abort the install.
 */
async function precachePosAssets(offlineCache) {
  try {
    const stored = await offlineCache.match(OFFLINE_POS_URL);
    if (!stored) return;
    const html = await stored.clone().text();
    const paths = new Set(html.match(/\/_next\/static\/[\w./@~-]+/g) ?? []);
    if (paths.size === 0) return;
    const staticCache = await caches.open(STATIC_CACHE);
    await Promise.all(
      [...paths].map(async (path) => {
        try {
          const response = await fetch(new Request(path, { cache: "reload" }));
          if (response.ok) await staticCache.put(path, response);
        } catch {
          // One missing chunk is not worth failing the install over.
        }
      })
    );
  } catch {
    // Same reasoning: a failed precache here only costs styling, not selling.
  }
}

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
  // fall back to a precached static page only when the network is genuinely
  // gone. Nothing from the network is ever written to a cache here.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request);
        } catch {
          const cache = await caches.open(OFFLINE_CACHE);
          // Any failed navigation — /sales/new mid-shift, a cold reload, a
          // bookmark — lands on the till. It is the only offline shell left,
          // and the sale in front of the cashier still has to be taken.
          return (await cache.match(OFFLINE_POS_URL)) ?? Response.error();
        }
      })()
    );
  }
});
