import { test, expect } from '@playwright/test';
import { login, apiRequest } from './helpers';

test.describe('Authentication', () => {
  test('login flow', async ({ page }) => {
    await login(page, 'manager@store.dev', 'password123');
    await expect(page).toHaveURL('/dashboard');
  });

  test('logout flow', async ({ page }) => {
    await login(page, 'manager@store.dev', 'password123');
    await page.click('[data-testid="logout"]');
    await expect(page).toHaveURL('/login');
  });

  test('password reset flow', async ({ page }) => {
    await page.goto('/login');
    await page.click('[data-testid="forgot-password"]');
    await page.locator('input[name="email"]').fill('manager@store.dev');
    await page.locator('button[type="submit"]').click();
    await expect(page.locator('[data-testid="reset-confirmation"]')).toBeVisible();
  });
});
