import { test, expect } from '@playwright/test';
import { ADMIN } from '../../fixtures/users';
import { loginAs } from '../../fixtures/auth';

// Phase 0 finding: the actual toggle is the hidden button #darkModeToggle.
// The dropdown menu item #darkModeToggleItem just programmatically calls
// .click() on it. Clicking the button with force: true mirrors what the
// menu item does, without the Bootstrap-dropdown UI surface.

async function toggleTheme(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    const el = document.getElementById('darkModeToggle') as HTMLElement | null;
    if (!el) throw new Error('#darkModeToggle not found');
    el.click();
  });
}

test('toggle dark mode: html attribute, persistence across reload and navigation, localStorage', async ({ page }) => {
  await loginAs(page, ADMIN.email, ADMIN.password);

  await expect(page.locator('html')).toHaveAttribute('data-bs-theme', 'light');

  await toggleTheme(page);
  await expect(page.locator('html')).toHaveAttribute('data-bs-theme', 'dark');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-bs-theme', 'dark');

  await page.goto('/hc_dash.php');
  await expect(page.locator('html')).toHaveAttribute('data-bs-theme', 'dark');

  const stored = await page.evaluate(() => window.localStorage.getItem('mv-theme'));
  expect(stored).toBe('dark');
});

test('toggle back to light mode', async ({ page }) => {
  await loginAs(page, ADMIN.email, ADMIN.password);

  await toggleTheme(page);
  await expect(page.locator('html')).toHaveAttribute('data-bs-theme', 'dark');

  await toggleTheme(page);
  await expect(page.locator('html')).toHaveAttribute('data-bs-theme', 'light');

  const stored = await page.evaluate(() => window.localStorage.getItem('mv-theme'));
  expect(stored).toBe('light');
});
