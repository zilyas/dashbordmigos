import { expect, test } from '@playwright/test';
import { login, requireCredentials } from './helpers';

// Every super-admin page must render without a client or server error boundary.
const PAGES = [
  '/dashboard', '/products', '/sales', '/sales/new', '/stores', '/users',
  '/categories', '/reports', '/reports/expiry', '/backups', '/settings',
  '/security', '/account', '/notifications', '/messages', '/announcements',
  '/activity', '/managers', '/sizes', '/colors', '/variant-axes',
];

test.describe('Dashboard pages render', () => {
  requireCredentials();

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  for (const path of PAGES) {
    test(`GET ${path}`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status(), `${path} returned ${response?.status()}`).toBeLessThan(400);
      await expect(page).toHaveURL(new RegExp(`${path.replace(/\//g, '\/')}$`));
      await expect(page.getByText(/Application error|Internal Server Error|Unhandled Runtime/i)).toHaveCount(0);
    });
  }
});
