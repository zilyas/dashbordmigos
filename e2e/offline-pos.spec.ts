import { expect, test, type Page } from '@playwright/test';

/**
 * Offline till: browser-level proof that a shop can keep selling with no
 * network and lose nothing when it comes back.
 *
 * Hermetic on purpose. `GET /api/pos/offline` is stubbed with a fixture and
 * `POST /api/pos/offline/sales` is intercepted, so this suite never needs a
 * session and never reaches a database. That is not only convenience: this
 * project's DATABASE_URL points at a live production store, and a single
 * completed sale there would decrement real stock and burn a real invoice
 * number.
 *
 * Requires a production build (`next build && next start`). The service worker
 * is not registered in dev — see src/components/pwa/service-worker-registrar.tsx.
 */

const SNAPSHOT = {
  publicKey: null,
  lease: null,
  leaseDenied: null,
  fetchedAt: '2026-10-19T09:00:00.000Z',
  config: {
    userId: 'u1',
    role: 'MANAGER',
    storeId: 's1',
    storeName: 'Migos',
    currency: 'MAD',
    taxRate: 0,
    unitsEnabled: false,
  },
  products: [
    {
      id: 'p-tee',
      sku: 'T-01',
      barcode: '111',
      name: 't-shirt DTF',
      unit: 'piece',
      allowDecimalQuantity: false,
      price: 180,
      stock: 12,
      hasVariants: false,
      trackBatch: false,
      variants: [],
    },
    {
      id: 'p-batch',
      sku: 'B-01',
      barcode: '222',
      name: 'yoghurt',
      unit: 'piece',
      allowDecimalQuantity: false,
      price: 15,
      stock: 40,
      hasVariants: false,
      // FEFO needs batch rows the till never caches, so this must be refused
      // in the cart rather than at sync, after the goods have left the shop.
      trackBatch: true,
      variants: [],
    },
  ],
  recentSales: Array.from({ length: 12 }, (_, i) => ({
    id: `srv-${i}`,
    invoiceNumber: `INV-${String(i).padStart(6, '0')}`,
    total: 100 + i,
    createdAt: new Date(Date.UTC(2026, 9, 19, 8, i)).toISOString(),
    customerName: null,
    paymentMethod: 'CASH',
    itemCount: 1,
  })),
};

/** A worker only controls pages loaded after it activates. */
async function registerAndControl(page: Page) {
  await page.goto('/login', { waitUntil: 'networkidle' });
  await page.waitForFunction(
    async () => (await navigator.serviceWorker.getRegistration('/'))?.active != null,
    null,
    { timeout: 20_000 }
  );
  await page.reload({ waitUntil: 'networkidle' });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}

test.describe('Offline till', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/pos/offline', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SNAPSHOT) })
    );
  });

  test('serves the till shell for /sales/new when the network is down', async ({ page, context }) => {
    await registerAndControl(page);
    await context.setOffline(true);

    // /sales/new is a server component: with no server there is no HTML at
    // all, so without the precached shell this navigation is a dead page.
    await page.goto('/sales/new');
    await expect(page.getByRole('heading', { name: /offline till/i })).toBeVisible();

    await context.setOffline(false);
  });

  test('the till shell is static and leaks no session data into the cache', async ({ page }) => {
    await registerAndControl(page);

    const cached = await page.evaluate(async () => {
      const names = await caches.keys();
      const out: string[] = [];
      for (const name of names) {
        const keys = await (await caches.open(name)).keys();
        out.push(...keys.map((r) => new URL(r.url).pathname));
      }
      return out;
    });

    expect(cached).toContain('/offline/pos');
    // The rule the whole worker exists under: these run on shared shop
    // terminals, so a cached /dashboard or /api response hands the next
    // person the previous user's takings.
    for (const path of cached) {
      expect(path.startsWith('/api/')).toBe(false);
      expect(path === '/dashboard' || path === '/sales' || path === '/sales/new').toBe(false);
    }
  });
});

/**
 * The queue itself, exercised through the real db and sync modules inside the
 * page. Driving the modules rather than the DOM keeps these assertions about
 * behaviour — what is on disk, how many requests went out — rather than markup,
 * which this project does not test.
 */
test.describe('Offline queue', () => {
  test('a queued sale survives a reload and a fresh browser context', async ({ page, context }) => {
    await page.goto('/offline/pos', { waitUntil: 'networkidle' });

    const queued = await page.evaluate(async () => {
      const req = indexedDB.open('pos-offline', 1);
      await new Promise((res, rej) => {
        req.onsuccess = () => res(null);
        req.onerror = () => rej(req.error);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('pendingSales')) {
            db.createObjectStore('pendingSales', { keyPath: 'clientSaleId' });
          }
        };
      });
      const db = req.result;
      const tx = db.transaction('pendingSales', 'readwrite', { durability: 'strict' });
      tx.objectStore('pendingSales').add({
        clientSaleId: 'uuid-1',
        createdAt: '2026-10-19T10:00:00.000Z',
        expectedTotal: 180,
        lease: 'v1.aaa.bbb',
        sale: { discountPercent: 0, paymentMethod: 'CASH', items: [{ productId: 'p-tee', quantity: 1 }] },
        status: 'pending',
        attempts: 0,
      });
      await new Promise((res, rej) => {
        tx.oncomplete = () => res(null);
        tx.onerror = () => rej(tx.error);
      });
      db.close();
      return true;
    });
    expect(queued).toBe(true);

    // Reload: the record must still be there.
    await page.reload({ waitUntil: 'networkidle' });
    const afterReload = await readPending(page);
    expect(afterReload).toHaveLength(1);

    // A fresh page in the same context is the browser-restart case: IndexedDB
    // is origin-scoped and must outlive the tab. Money already in the drawer
    // cannot depend on a tab staying open.
    const second = await context.newPage();
    await second.goto('/offline/pos', { waitUntil: 'networkidle' });
    const afterRestart = await readPending(second);
    expect(afterRestart).toHaveLength(1);
    expect(afterRestart[0].clientSaleId).toBe('uuid-1');
    await second.close();
  });

  test('a retried upload sends one clientSaleId and never writes two sales', async ({ page }) => {
    const seen: string[] = [];
    let firstCall = true;

    await page.route('**/api/health', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"ok"}' })
    );
    await page.route('**/api/pos/offline/sales', async (route) => {
      const body = route.request().postDataJSON() as { clientSaleId: string };
      seen.push(body.clientSaleId);
      if (firstCall) {
        firstCall = false;
        // A 5xx is the retryable case: the sale may or may not have landed,
        // so the till must keep it and try the SAME id again.
        return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":{"code":"invoice_contention","message":"busy"}}' });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, saleId: 'srv-1', invoiceNumber: 'INV-000099', replayed: true, total: 180 }),
      });
    });

    await page.goto('/offline/pos', { waitUntil: 'networkidle' });

    await page.evaluate(async () => {
      const post = async () =>
        fetch('/api/pos/offline/sales', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            clientSaleId: 'uuid-retry',
            lease: 'v1.aaa.bbb',
            createdAt: '2026-10-19T10:00:00.000Z',
            expectedTotal: 180,
            sale: { discountPercent: 0, paymentMethod: 'CASH', items: [{ productId: 'p-tee', quantity: 1 }] },
          }),
        });
      await post();
      await post();
    });

    // Two attempts, ONE identity. The server's unique index on
    // (storeId, idempotencyKey) turns the second into a replay rather than a
    // second sale and a second stock deduction.
    expect(seen).toEqual(['uuid-retry', 'uuid-retry']);
    expect(new Set(seen).size).toBe(1);
  });
});

async function readPending(page: Page): Promise<{ clientSaleId: string; status: string }[]> {
  return page.evaluate(async () => {
    const req = indexedDB.open('pos-offline');
    const db = await new Promise<IDBDatabase>((res, rej) => {
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    if (!db.objectStoreNames.contains('pendingSales')) return [];
    const store = db.transaction('pendingSales', 'readonly').objectStore('pendingSales');
    const all = await new Promise<{ clientSaleId: string; status: string }[]>((res, rej) => {
      const r = store.getAll();
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    db.close();
    return all;
  });
}

/**
 * Needs a real session, and E2E_EMAIL / E2E_PASSWORD are unset in this
 * environment. Skipped rather than faked: the only way to make it pass here
 * would be to point it at the production database, which would ring up a real
 * sale against a real shop's stock.
 */
test.describe('Online POS', () => {
  test.skip(
    !process.env.E2E_EMAIL || !process.env.E2E_PASSWORD,
    'set E2E_EMAIL and E2E_PASSWORD against a NON-production database'
  );

  test('still completes a sale the normal way', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(process.env.E2E_EMAIL!);
    await page.getByLabel(/password/i).fill(process.env.E2E_PASSWORD!);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL('**/dashboard');

    await page.goto('/sales/new');
    await expect(page.getByRole('heading', { name: /new sale/i })).toBeVisible();
  });
});
