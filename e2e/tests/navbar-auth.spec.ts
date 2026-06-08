import { test, expect } from '../fixtures/auth';

test.describe('Navbar auth journey', () => {
  test('logged-out visitor sees sign-in link', async ({ anonPage }) => {
    await anonPage.goto('/');

    const signInLink = anonPage.getByRole('link', { name: /sign in|登入/i });
    await expect(signInLink).toBeVisible({ timeout: 10_000 });
    await expect(signInLink).toHaveAttribute('href', '/auth/sign-in');
  });

  test('authenticated user sees account menu, not sign-in link', async ({ userPage }) => {
    await userPage.goto('/');

    const accountTrigger = userPage.getByRole('button', { name: /account|帳號/i });
    await expect(accountTrigger).toBeVisible({ timeout: 10_000 });
    await expect(userPage.getByRole('link', { name: /sign in|登入/i })).toHaveCount(0);

    await accountTrigger.click();

    const accountMenu = userPage.locator('[data-slot="dropdown-menu-content"]');
    const dashboardLink = accountMenu.locator('a[href="/dashboard"]');
    const signOutItem = accountMenu.getByText(/sign out|登出/i);

    await expect(dashboardLink).toBeVisible({ timeout: 10_000 });
    await expect(dashboardLink).toHaveAttribute('href', '/dashboard');
    await expect(dashboardLink).toContainText(/dashboard|管理後台/i);
    await expect(signOutItem).toBeVisible({ timeout: 10_000 });
  });

  test('sign out from authenticated session returns to logged-out home state', async ({ userPage }) => {
    await userPage.goto('/');

    const accountTrigger = userPage.getByRole('button', { name: /account|帳號/i });
    await expect(accountTrigger).toBeVisible({ timeout: 10_000 });
    await accountTrigger.click();

    const accountMenu = userPage.locator('[data-slot="dropdown-menu-content"]');
    const signOutItem = accountMenu.getByText(/sign out|登出/i);
    await expect(signOutItem).toBeVisible({ timeout: 10_000 });

    await signOutItem.click();

    // After sign-out, poll-reload home until the navbar reflects the logged-out state
    // (session-cookie clear + navbar re-render can lag the click).
    await expect(async () => {
      await userPage.goto('/');
      await expect(userPage.getByRole('link', { name: /sign in|登入/i })).toBeVisible();
      await expect(userPage.getByRole('button', { name: /account|帳號/i })).toHaveCount(0);
    }).toPass({ timeout: 20_000, intervals: [1_000, 2_000, 3_000, 5_000] });
  });
});
