import { test, expect } from '@playwright/test';

test('login page renders', async ({ page }) => {
  await page.goto('/index.php');
  await expect(page).toHaveTitle(/My Vivarium/i);
  await expect(page.locator('input[name="username"]')).toBeVisible();
  await expect(page.locator('input[name="password"]')).toBeVisible();
  await expect(page.locator('button[name="login"]')).toBeVisible();
});
