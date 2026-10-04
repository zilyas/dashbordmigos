import { expect, test } from '@playwright/test';

/**
 * PWA installability and offline behaviour.
 *
 * Unauthenticated on purpose — the browser fetches the manifest and the service
 * worker WITHOUT credentials, which is exactly the failure this suite guards:
 * if either one starts answering with the proxy's 302 to /login, installation
 * and worker registration break silently, with nothing in any log.
 *
 * Requires a production build (`next build && next start`). The worker is not
 * registered in dev — see src/components/pwa/service-worker-registrar.tsx.
 */

// A service worker only controls pages loaded after it activates, so every
// offline assertion needs one reload after registration.
async function registerAndControl(page: import('@playwright/test').Page) {
  await page.goto('/login', { waitUntil: 'networkidle' });
  await page.waitForFunction(
    async () => (await navigator.serviceWorker.getRegistration('/'))?.active != null,
    null,
    { timeout: 20_000 }
  );
  await page.reload({ waitUntil: 'networkidle' });
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
}

test.describe('PWA install metadata', () => {
  test('manifest is reachable without a session and is installable', async ({ page }) => {
    await page.goto('/login');

    const href = await page.getAttribute('link[rel="manifest"]', 'href');
    expect(href).toBeTruthy();

    const manifest = await page.evaluate(async (url) => {
      const res = await fetch(url!);
      return { status: res.status, body: await res.json() };
    }, href);

    // A 302 here means the proxy matcher stopped excluding the manifest.
    expect(manifest.status).toBe(200);
    expect(manifest.body.display).toBe('standalone');
    expect(manifest.body.start_url).toBe('/dashboard');

    // Android masks icons to its own shape; without maskable art the glyph is clipped.
    const maskable = manifest.body.icons.filter((i: { purpose?: string }) => i.purpose === 'maskable');
    expect(maskable.length).toBeGreaterThanOrEqual(2);

    // Every icon the manifest promises must exist, or install is refused.
    const statuses = await page.evaluate(
      async (icons: { src: string }[]) =>
        Promise.all(icons.map(async (i) => (await fetch(i.src)).status)),
      manifest.body.icons
    );
    expect(statuses.every((s) => s === 200)).toBe(true);
  });

  test('iOS and Android chrome hints are present', async ({ page }) => {
    await page.goto('/login');
    // iOS ignores the manifest for these two; only the meta/link tags work.
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
    await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute('content', 'Store OS');
    await expect(page.locator('meta[name="mobile-web-app-capable"]')).toHaveAttribute('content', 'yes');
    await expect(page.locator('meta[name="theme-color"]')).toHaveCount(2);
  });
});

test.describe('Service worker', () => {
  test('registers at the site root and precaches only safe things', async ({ page }) => {
    await registerAndControl(page);

    const registration = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration('/');
      return { scope: reg?.scope, script: reg?.active?.scriptURL };
    });
    expect(registration.script).toContain('/sw.js');
    expect(registration.scope?.endsWith('/')).toBe(true);

    const cached = await page.evaluate(async () => {
      const out: Record<string, string[]> = {};
      for (const name of await caches.keys()) {
        out[name] = (await (await caches.open(name)).keys()).map((r) => new URL(r.url).pathname);
      }
      return out;
    });

    // The offline fallback must be precached at install, or the fallback
    // navigation below has nothing to serve.
    expect(Object.values(cached).flat()).toContain('/offline');

    // SECURITY: dashboard pages are rendered per session, store and role. A
    // cached one is readable by the next person to pick up a shared terminal,
    // after logout, with no session. Same for /api, which carries stock and
    // sales data. Nothing from either may ever land in a cache.
    const leaked = Object.values(cached)
      .flat()
      .filter((p) => p.startsWith('/api/') || ['/dashboard', '/products', '/sales', '/login'].includes(p));
    expect(leaked, `cached session-scoped paths: ${leaked.join(', ')}`).toEqual([]);
  });
});

test.describe('Offline behaviour', () => {
  test('serves the fallback page, leaks nothing, and recovers', async ({ page, context }) => {
    await registerAndControl(page);
    // Warm one immutable asset so there is something to serve from cache.
    await page.evaluate(() => fetch('/icons/icon-192.png'));

    await context.setOffline(true);

    // A cold navigation with no network: the worker must answer, not the
    // browser's network-error page.
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' }).catch(() => {});
    await expect(page.getByRole('heading', { name: 'You are offline' })).toBeVisible();

    const body = (await page.textContent('body')) ?? '';
    for (const marker of ['Sign out', 'Dashboard overview', 'Total sales']) {
      expect(body, `offline page leaked authenticated content: ${marker}`).not.toContain(marker);
    }

    expect(await page.evaluate(async () => (await fetch('/icons/icon-192.png')).ok)).toBe(true);

    // The fallback must style ITSELF. Tailwind lives in a hashed stylesheet that
    // may never have been fetched before the device went offline, so if this page
    // depended on it the user would get unstyled serif text at the worst moment.
    const rendered = await page.evaluate(() => {
      const el = document.querySelector('main');
      if (!el) return null;
      const s = getComputedStyle(el);
      return { font: s.fontFamily, justify: s.justifyContent };
    });
    expect(rendered?.justify, 'offline page lost its layout CSS').toBe('center');
    // Note the `sans-` guard: a bare /serif$/ also matches "sans-serif".
    expect(rendered?.font ?? '', 'offline page fell back to the default serif')
      .not.toMatch(/(^|[^-])serif\s*$/i);

    // The fallback must not be sticky once the connection returns.
    await context.setOffline(false);
    await page.goto('/login', { waitUntil: 'networkidle' });
    expect(await page.textContent('body')).not.toContain('You are offline');
  });
});
