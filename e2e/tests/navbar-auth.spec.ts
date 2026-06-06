import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/auth';

async function signInWithSeededUser(page: Page) {
  const email = process.env.E2E_USER_EMAIL;
  const password = process.env.E2E_USER_PASSWORD;

  if (!email || !password) {
    throw new Error('E2E_USER_EMAIL and E2E_USER_PASSWORD must be set');
  }

  await expect(page.getByRole('heading', { name: '登入', exact: true })).toBeVisible({
    timeout: 10_000,
  });

  await page.getByLabel('電子郵件', { exact: true }).fill(email);
  await page.getByLabel('密碼', { exact: true }).fill(password);

  await Promise.all([
    page.waitForURL(/\/dashboard(?:[/?#]|$)/, { timeout: 15_000 }),
    page.getByRole('button', { name: '登入', exact: true }).click(),
  ]);
}

test.describe('Navbar auth journey', () => {
  test('shows sign in when logged out, then account menu after sign in, then returns home on sign out', async ({
    anonPage,
  }) => {
    await anonPage.goto('/');

    const signInLink = anonPage.getByRole('link', { name: /sign in|登入/i });

    await expect(signInLink).toBeVisible({ timeout: 10_000 });
    await expect(signInLink).toHaveAttribute('href', '/auth/sign-in');

    await Promise.all([
      anonPage.waitForURL(/\/auth\/sign-in(?:[/?#]|$)/, { timeout: 15_000 }),
      signInLink.click(),
    ]);

    await signInWithSeededUser(anonPage);

    const accountTrigger = anonPage.getByRole('button', { name: /account|帳號/i });

    await expect(accountTrigger).toBeVisible({ timeout: 10_000 });
    await accountTrigger.click();

    const accountMenu = anonPage.locator('[data-slot="dropdown-menu-content"]');
    const dashboardLink = accountMenu.locator('a[href="/dashboard"]');
    const signOutItem = accountMenu.getByText(/sign out|登出/i);

    await expect(dashboardLink).toBeVisible({ timeout: 10_000 });
    await expect(dashboardLink).toHaveAttribute('href', '/dashboard');
    await expect(dashboardLink).toContainText(/dashboard|管理後台/i);
    await expect(signOutItem).toBeVisible({ timeout: 10_000 });

    await Promise.all([
      anonPage.waitForURL(/\/(?:[?#].*)?$/, { timeout: 15_000 }),
      signOutItem.click(),
    ]);

    await expect(anonPage).toHaveURL(/\/(?:[?#].*)?$/);
    await expect(anonPage.getByRole('link', { name: /sign in|登入/i })).toBeVisible({
      timeout: 10_000,
    });
  });
});
