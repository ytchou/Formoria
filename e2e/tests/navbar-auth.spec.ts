import { createClient } from '@supabase/supabase-js';
import { test, expect } from '../fixtures/auth';

test.describe('Navbar auth journey', () => {
  test('logged-out visitor sees sign-in link', async ({ anonPage }) => {
    await anonPage.goto('/');

    const signInLink = anonPage.getByRole('link', { name: /sign in|登入/i });
    await expect(signInLink).toBeVisible({ timeout: 10_000 });
    // href includes ?next=... query param — assert it starts with /auth/sign-in
    await expect(signInLink).toHaveAttribute('href', /^\/auth\/sign-in/);
  });

  test('authenticated user sees account menu, not sign-in link', async ({ userPage }) => {
    await userPage.goto('/');

    const accountTrigger = userPage.getByRole('button', { name: /account|帳號/i });
    await expect(accountTrigger).toBeVisible({ timeout: 10_000 });
    await expect(userPage.getByRole('link', { name: /sign in|登入/i })).toHaveCount(0);

    // Dashboard link moved to main nav header (nav.myBrands = "我的品牌") — not in dropdown
    const dashboardNavLink = userPage.getByRole('link', { name: '我的品牌' });
    await expect(dashboardNavLink).toBeVisible({ timeout: 10_000 });
    await expect(dashboardNavLink).toHaveAttribute('href', '/dashboard');

    await accountTrigger.click();

    // Account dropdown: Base-UI DropdownMenuItem renders role="menuitem" (not "link")
    // even when the render prop is a Link/anchor — use getByRole('menuitem').
    const accountMenu = userPage.locator('[data-slot="dropdown-menu-content"]');
    await expect(accountMenu).toBeVisible({ timeout: 10_000 });
    await expect(accountMenu.getByRole('menuitem', { name: '帳號設定' })).toBeVisible({ timeout: 5_000 });
    await expect(accountMenu.getByRole('menuitem', { name: '收藏品牌' })).toBeVisible({ timeout: 5_000 });
    const signOutItem = accountMenu.getByText(/sign out|登出/i);
    await expect(signOutItem).toBeVisible({ timeout: 10_000 });
    // Dashboard link is NOT in the dropdown (moved to main nav)
    await expect(accountMenu.locator('a[href="/dashboard"]')).toHaveCount(0);
  });

  test('sign out from authenticated session returns to logged-out home state', async ({ browser }) => {
    test.setTimeout(120_000);

    // IMPORTANT: Do NOT use the shared userPage fixture here.
    //
    // Supabase signOut defaults to scope:'global', revoking ALL refresh tokens for
    // the signed-out account — including every other Playwright worker's stored
    // session for the same user.  A one-shot disposable account is created for this
    // test so the global-scope sign-out affects only a throwaway user and never
    // poisons the shared E2E_USER_EMAIL sessions that other workers depend on.
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    const ts = Date.now();
    const disposableEmail = `e2e-signout-${ts}@test.local`;
    const disposablePassword = `Signout${ts}A!`;

    const { data: createData, error: createError } = await supabase.auth.admin.createUser({
      email: disposableEmail,
      password: disposablePassword,
      email_confirm: true,
    });
    if (createError || !createData.user) {
      throw new Error(`Failed to create disposable sign-out user: ${createError?.message}`);
    }
    const disposableUserId = createData.user.id;

    // Isolated browser context — cookies are separate from the shared worker session
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      // Sign in via the UI as the disposable user
      await page.goto('/auth/sign-in', { timeout: 60_000 });
      await expect(page.getByRole('heading', { name: '登入 Formoria' })).toBeVisible({ timeout: 30_000 });
      await page.getByLabel('電子郵件', { exact: true }).fill(disposableEmail);
      await page.getByLabel('密碼', { exact: true }).fill(disposablePassword);
      await page.getByRole('button', { name: '登入', exact: true }).click();
      // Wait for any redirect away from the sign-in page (to /dashboard or similar)
      await page.waitForURL((url) => !url.pathname.includes('/auth/sign-in'), { timeout: 60_000 });

      // Navigate home — verify the account menu is present (user is authenticated)
      await page.goto('/');
      const accountTrigger = page.getByRole('button', { name: /account|帳號/i });
      await expect(accountTrigger).toBeVisible({ timeout: 15_000 });
      await accountTrigger.click();

      const accountMenu = page.locator('[data-slot="dropdown-menu-content"]');
      const signOutItem = accountMenu.getByText(/sign out|登出/i);
      await expect(signOutItem).toBeVisible({ timeout: 10_000 });

      await signOutItem.click();

      // After sign-out, poll-reload home until the navbar reflects the logged-out state
      // (session-cookie clear + navbar re-render can lag the click).
      await expect(async () => {
        await page.goto('/');
        await expect(page.getByRole('link', { name: /sign in|登入/i })).toBeVisible();
        await expect(page.getByRole('button', { name: /account|帳號/i })).toHaveCount(0);
      }).toPass({ timeout: 20_000, intervals: [1_000, 2_000, 3_000, 5_000] });
    } finally {
      await context.close();
      // Always delete the disposable user — resilient to mid-test failures
      const { error: deleteError } = await supabase.auth.admin.deleteUser(disposableUserId);
      if (deleteError) {
        console.warn('[e2e-cleanup] deleteUser error:', deleteError.message);
      }
    }
  });
});
