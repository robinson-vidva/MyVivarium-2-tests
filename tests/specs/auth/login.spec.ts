import { test, expect, Page } from '@playwright/test';
import { withDb } from '../../fixtures/db';
import { ensureUser, unlockUser, deleteUser, ADMIN, VM, USER } from '../../fixtures/users';
import { uniq } from '../../fixtures/uniq';

test.beforeAll(async () => {
  await ensureUser({ email: VM.email,   name: 'VM Tester',   role: 'vivarium_manager', initials: 'VMT' });
  await ensureUser({ email: USER.email, name: 'User Tester', role: 'user',             initials: 'UST' });
});

test.beforeEach(async () => {
  await unlockUser(ADMIN.email);
  await unlockUser(VM.email);
  await unlockUser(USER.email);
});

async function submitLogin(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/index.php');
  await page.fill('input[name="username"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[name="login"]');
}

test('@smoke admin can log in', async ({ page }) => {
  await submitLogin(page, ADMIN.email, ADMIN.password);
  await expect(page).toHaveURL(/\/home\.php(\?|$)/);
});

test('@smoke vivarium manager can log in', async ({ page }) => {
  await submitLogin(page, VM.email, VM.password);
  await expect(page).toHaveURL(/\/home\.php(\?|$)/);
});

test('@smoke standard user can log in', async ({ page }) => {
  await submitLogin(page, USER.email, USER.password);
  await expect(page).toHaveURL(/\/home\.php(\?|$)/);
});

test('wrong password rejected with uniform message', async ({ page }) => {
  await submitLogin(page, ADMIN.email, 'WrongPassword!');
  await expect(page).toHaveURL(/\/index\.php(\?|$)/);
  await expect(page.locator('.alert-danger')).toContainText('Invalid credentials. Please try again.');
});

test('login error identical for unknown email vs wrong password (no enumeration)', async ({ page }) => {
  await submitLogin(page, ADMIN.email, 'WrongPassword!');
  const wrongPwText = (await page.locator('.alert-danger').innerText()).trim();

  await submitLogin(page, `${uniq('nobody')}@nowhere.test`, 'whatever');
  const unknownText = (await page.locator('.alert-danger').innerText()).trim();

  expect(wrongPwText).toBe(unknownText);
  expect(wrongPwText).toContain('Invalid credentials');
});

test('logout destroys session', async ({ page }) => {
  await submitLogin(page, ADMIN.email, ADMIN.password);
  await expect(page).toHaveURL(/\/home\.php(\?|$)/);

  await page.goto('/logout.php');

  await page.goto('/home.php');
  await expect(page).toHaveURL(/\/index\.php(\?|$)/);
});

test('protected pages redirect to login when unauthenticated', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const protectedPaths = [
    '/home.php',
    '/hc_dash.php',
    '/bc_dash.php',
    '/mouse_dash.php',
    '/calendar.php',
    '/manage_users.php',
    '/manage_tasks.php',
    '/activity_log.php',
  ];
  for (const path of protectedPaths) {
    await page.goto(path);
    await expect(page, `${path} should redirect to login`).toHaveURL(/\/index\.php(\?|$)/);
  }
  await context.close();
});

test('account lockout after 3 failed attempts; 15-minute duration', async ({ page }) => {
  const email = `${uniq('lockout')}@test.local`;
  await ensureUser({ email, name: 'Lockout Tester', role: 'user', initials: 'LCK' });
  try {
    for (let i = 0; i < 3; i++) {
      await submitLogin(page, email, `WrongPassword${i}`);
    }
    await expect(page.locator('.alert-danger')).toContainText('temporarily locked');

    await submitLogin(page, email, USER.password);
    await expect(page.locator('.alert-danger')).toContainText('temporarily locked');
    await expect(page).toHaveURL(/\/index\.php(\?|$)/);

    const row = await withDb(async (con) => {
      const [rows] = await con.execute(
        'SELECT account_locked, login_attempts FROM users WHERE username = ?',
        [email],
      );
      return (rows as Array<{ account_locked: string | null; login_attempts: number }>)[0];
    });
    expect(row.login_attempts).toBe(3);
    expect(row.account_locked).not.toBeNull();

    const lockedAt = new Date(`${row.account_locked}Z`);
    const diffMin = (lockedAt.getTime() - Date.now()) / 60_000;
    expect(diffMin).toBeGreaterThan(13);
    expect(diffMin).toBeLessThan(16);
  } finally {
    await deleteUser(email);
  }
});
