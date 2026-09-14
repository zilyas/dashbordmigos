import { expect, test, type Page } from '@playwright/test';

/**
 * E2E sign-in credentials. These are NOT the seed defaults: the seeder leaves an
 * existing Super Admin's password untouched, so `SEED_SUPER_ADMIN_PASSWORD` in
 * `.env` can drift from what is actually in the database. Set these explicitly.
 */
export const E2E_USER = {
  email: process.env.E2E_EMAIL ?? '',
  password: process.env.E2E_PASSWORD ?? '',
};

export const hasCredentials = !!E2E_USER.email && !!E2E_USER.password;

/** Skips the calling suite when no E2E credentials are configured. */
export function requireCredentials() {
  test.skip(!hasCredentials, 'Set E2E_EMAIL and E2E_PASSWORD to run authenticated E2E tests.');
}

/** Signs in through the real form and waits for the dashboard to take over. */
export async function login(page: Page, email = E2E_USER.email, password = E2E_USER.password) {
  await page.goto('/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL('/dashboard', { timeout: 15_000 });
}
