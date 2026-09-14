import { test, expect } from '@playwright/test';
import { login, apiRequest } from './helpers';

test.describe('Sales', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'manager@store.dev', 'password123');
  });

  test('create sale', async ({ page }) => {
    await page.goto('/sales/new');
    await page.locator('[data-testid="product-select"]').click();
    await page.locator('[data-testid="product-option"]').first().click();
    await page.locator('[data-testid="quantity-input"]').fill('1');
    await page.locator('button[type="submit"]').click();
    await expect(page.locator('[data-testid="sale-confirmation"]')).toBeVisible();
  });

  test('return items', async ({ page }) => {
    await page.goto('/sales');
    const firstSale = page.locator('[data-testid="sale-row"]').first();
    await firstSale.click();
    await page.click('[data-testid="return-button"]');
    await expect(page.locator('[data-testid="return-confirmation"]')).toBeVisible();
  });
});
