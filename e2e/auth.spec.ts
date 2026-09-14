import { expect, test } from '@playwright/test';
import { E2E_USER, login, requireCredentials } from './helpers';

test.describe('Authentication (no credentials needed)', () => {
  test('unauthenticated visitor is redirected to login', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });

  test('wrong password keeps the user on /login with an error', async ({ page }) => {
    await page.goto('/login');
    await page.locator('#email').fill('nobody@example.invalid');
    await page.locator('#password').fill('definitely-not-the-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText(/invalid email or password/i)).toBeVisible({ timeout: 15_000 });
  });

  test('forgot password issues a reset link', async ({ page }) => {
    await page.goto('/forgot-password');
    await page.locator('#email').fill('nobody@example.invalid');
    await page.getByRole('button', { name: 'Send reset link' }).click();
    // Response is deliberately the same for unknown addresses (no account enumeration).
    await expect(page.getByText(/check your email|reset link/i).first()).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('Authenticated session', () => {
  requireCredentials();

  test('sign in lands on the dashboard', async ({ page }) => {
    await login(page);
    await expect(page.locator('header')).toBeVisible();
  });

  test('sign out returns to login', async ({ page }) => {
    await login(page);
    await page.locator('header button').last().click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  });

  test('forgot password for a real account renders a dev reset link', async ({ page }) => {
    await page.goto('/forgot-password');
    await page.locator('#email').fill(E2E_USER.email);
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByRole('link', { name: /reset-password/ })).toBeVisible({ timeout: 15_000 });
  });
});
