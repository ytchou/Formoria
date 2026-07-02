import { test, expect } from '../fixtures/auth';

/**
 * Smoke: navbar auth journey — cross-browser safe.
 * Complements the deep spec (e2e/tests/navbar-auth.spec.ts) with a trimmed,
 * no-live-sign-in version that exercises the auth fixture storage state.
 *
 * Kept fast by skipping the full email/password sign-in UI flow and instead
 * arriving pre-authenticated via the `userPage` storage state.
 */
test.describe('Navbar auth smoke', () => {
  test('logged-out visitor sees sign-in link', async ({ anonPage }) => {
    await anonPage.goto('/');
    const signInLink = anonPage.getByRole('link', { name: /sign in|登入/i });
    await expect(signInLink).toBeVisible({ timeout: 10_000 });
    await expect(signInLink).toHaveAttribute('href', /^\/auth\/sign-in/);
  });

  test('authenticated user sees account menu, not sign-in link', async ({ userPage }) => {
    await userPage.goto('/');

    // Account menu trigger must be visible
    const accountTrigger = userPage.getByRole('button', { name: /account|帳號/i });
    await expect(accountTrigger).toBeVisible({ timeout: 10_000 });

    // Sign-in link must not appear for authenticated user
    await expect(userPage.getByRole('link', { name: /sign in|登入/i })).toHaveCount(0);

    // Dashboard link moved to main nav header (nav.myBrands = "我的品牌") — not in dropdown
    const dashboardNavLink = userPage.getByRole('link', { name: '我的品牌' });
    await expect(dashboardNavLink).toBeVisible({ timeout: 10_000 });
    await expect(dashboardNavLink).toHaveAttribute('href', '/dashboard');

    // Open the account dropdown — use click (works cross-browser including WebKit)
    await accountTrigger.click();

    const accountMenu = userPage.locator('[data-slot="dropdown-menu-content"]');
    await expect(accountMenu).toBeVisible({ timeout: 10_000 });

    // Dashboard link is NOT in the dropdown (moved to main nav)
    await expect(accountMenu.locator('a[href="/dashboard"]')).toHaveCount(0);

    // Favorites link in the menu (account.favorites = "收藏品牌")
    const favoritesLink = accountMenu.locator('a[href*="favorites"]');
    await expect(favoritesLink).toBeVisible({ timeout: 5_000 });

    // Sign-out item must be in the menu
    const signOutItem = accountMenu.getByText(/sign out|登出/i);
    await expect(signOutItem).toBeVisible({ timeout: 5_000 });
  });

  test('sign-in page renders heading and Google OAuth button', async ({ anonPage }) => {
    await anonPage.goto('/auth/sign-in');
    // Heading key: auth.signIn.heading = "登入 Formoria"
    await expect(anonPage.getByRole('heading', { name: '登入 Formoria', exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      anonPage.getByRole('button', { name: '使用 Google 登入', exact: true })
    ).toBeVisible({ timeout: 5_000 });
  });
});
