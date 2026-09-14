import { Page, APIRequestContext } from '@playwright/test';

export async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL('/dashboard', { timeout: 5000 }).catch(() => {});
}

export async function apiRequest(
  page: Page,
  method: string,
  path: string,
  body?: Record<string, unknown>
) {
  const response = await page.request.fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return response;
}

export async function seedTestData(page: Page) {
  await apiRequest(page, 'POST', '/api/cron/seed', { force: true });
}
