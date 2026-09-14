import { test, expect } from '@playwright/test';
import { login, apiRequest } from './helpers';

test.describe('Batch Management', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'manager@store.dev', 'password123');
  });

  test('create batch', async ({ page }) => {
    await page.goto('/batches');
    await page.click('[data-testid="create-batch"]');
    await page.locator('input[name="name"]').fill('Batch 2026-09');
    await page.locator('input[name="expiryDate"]').fill('2026-12-31');
    await page.locator('button[type="submit"]').click();
    await expect(page.locator('[data-testid="batch-created"]')).toBeVisible();
  });

  test('track expiry', async ({ page }) => {
    await page.goto('/batches');
    const batchRow = page.locator('[data-testid="batch-row"]').first();
    await batchRow.click();
    await expect(page.locator('[data-testid="expiry-date"]')).toBeVisible();
  });
});
