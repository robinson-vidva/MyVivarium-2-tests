import { test as base, expect, Page } from '@playwright/test';

export const ADMIN_EMAIL = 'admin@myvivarium.online';
export const ADMIN_PASSWORD = 'P@ssw0rd';

export async function loginAs(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/index.php');
  await page.fill('input[name="username"]', email);
  await page.fill('input[name="password"]', password);
  await Promise.all([
    page.waitForURL(/\/home\.php(\?|$)/),
    page.click('button[name="login"]'),
  ]);
}

export async function logout(page: Page): Promise<void> {
  await page.goto('/logout.php');
}

type AuthFixtures = {
  adminPage: Page;
};

export const test = base.extend<AuthFixtures>({
  adminPage: async ({ page }, use) => {
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await use(page);
  },
});

export { expect };
