import { createClient } from "@supabase/supabase-js";
import { test, expect } from "../fixtures/auth";

import { BUDGET, POLL } from "../budgets";

async function createDisposableSignOutUser() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const ts = Date.now();
  const email = `e2e-signout-${ts}@test.local`;
  const password = `Signout${ts}A!`;
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(
      `Failed to create disposable sign-out user: ${error?.message}`,
    );
  }
  return { supabase, userId: data.user.id, email, password };
}

async function deleteDisposableSignOutUser(
  supabase: ReturnType<typeof createClient>,
  userId: string,
) {
  const { error } = await supabase.auth.admin.deleteUser(userId);
  if (error) {
    throw new Error(`[e2e-cleanup] sign-out user deletion failed: ${error.message}`);
  }
}

test.describe("Navbar auth journey", () => {
  test("@smoke logged-out visitor sees sign-in link", async ({ anonPage }) => {
    await anonPage.goto("/");

    const signInLink = anonPage.getByRole("link", { name: /sign in|登入/i });
    await expect(signInLink).toBeVisible({ timeout: BUDGET.INTERACTIVE });
    // href includes ?next=... query param — assert it starts with the sign-in
    // route, which carries an /en prefix on English pages.
    await expect(signInLink).toHaveAttribute(
      "href",
      /^(?:\/en)?\/auth\/sign-in/,
    );
  });

  test("@smoke authenticated user sees account menu, not sign-in link", async ({
    userPage,
  }) => {
    await userPage.goto("/");

    const accountTrigger = userPage.getByRole("button", {
      name: /account|帳號/i,
    });
    await expect(accountTrigger).toBeVisible({ timeout: BUDGET.INTERACTIVE });
    await expect(
      userPage.getByRole("link", { name: /sign in|登入/i }),
    ).toHaveCount(0);

    // "我的品牌" link is conditional on hasOwnedBrand AND ownerFeaturesEnabled — shown
    // only when the user owns a brand and owner features are turned on (DEV-1261).
    // That nav link is NOT in the account dropdown (verified below); testing its presence
    // requires a seeded brand_owners row which belongs in dashboard-specific tests.

    await accountTrigger.click();

    // Account dropdown: Base-UI DropdownMenuItem renders role="menuitem" (not "link")
    // even when the render prop is a Link/anchor — use getByRole('menuitem').
    const accountMenu = userPage.locator('[data-slot="dropdown-menu-content"]');
    await expect(accountMenu).toBeVisible({ timeout: BUDGET.INTERACTIVE });
    await expect(
      accountMenu.getByRole("menuitem", { name: "帳號設定" }),
    ).toBeVisible({ timeout: BUDGET.RENDERED });
    await expect(
      accountMenu.getByRole("menuitem", { name: "收藏品牌" }),
    ).toBeVisible({ timeout: BUDGET.RENDERED });
    await expect(
      accountMenu.getByRole("menuitem", { name: "我的貢獻" }),
    ).toBeVisible({ timeout: BUDGET.RENDERED });
    // "我的推薦" is deliberately not asserted here: it is gated on
    // ownerFeaturesEnabled (DEV-1261), so its presence is flag state, not navbar
    // behaviour. Its absence is owned by owner-features-flag-off.spec.ts.
    const signOutItem = accountMenu.getByText(/sign out|登出/i);
    await expect(signOutItem).toBeVisible({ timeout: BUDGET.INTERACTIVE });
    // Dashboard link is NOT in the dropdown (moved to main nav)
    await expect(accountMenu.locator('a[href="/dashboard"]')).toHaveCount(0);
  });

  test("sign out from authenticated session returns to logged-out home state", async ({
    browser,
  }) => {
    test.setTimeout(BUDGET.TEST.ADMIN);
    // IMPORTANT: Do NOT use the shared userPage fixture here.
    //
    // Supabase signOut defaults to scope:'global', revoking ALL refresh tokens for
    // the signed-out account — including every other Playwright worker's stored
    // session for the same user.  A one-shot disposable account is created for this
    // test so the global-scope sign-out affects only a throwaway user and never
    // poisons the shared E2E_USER_EMAIL sessions that other workers depend on.
    const {
      supabase,
      userId: disposableUserId,
      email: disposableEmail,
      password: disposablePassword,
    } = await createDisposableSignOutUser();

    // Isolated browser context — cookies are separate from the shared worker session
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      // Sign in via the UI as the disposable user
      await page.goto("/auth/sign-in");
      await expect(
        page.getByRole("heading", { name: "登入 Formoria" }),
      ).toBeVisible({ timeout: BUDGET.GATED_UI });
      await page.getByLabel("電子郵件", { exact: true }).fill(disposableEmail);
      await page.getByLabel("密碼", { exact: true }).fill(disposablePassword);
      await page.getByRole("button", { name: "登入", exact: true }).click();
      // Wait for any redirect away from the sign-in page (to /dashboard or similar)
      await page.waitForURL((url) => !url.pathname.includes("/auth/sign-in"));

      // Navigate home — verify the account menu is present (user is authenticated)
      await page.goto("/");
      const accountTrigger = page.getByRole("button", {
        name: /account|帳號/i,
      });
      await expect(accountTrigger).toBeVisible({
        timeout: BUDGET.SERVER_RENDER,
      });
      await accountTrigger.click();

      const accountMenu = page.locator('[data-slot="dropdown-menu-content"]');
      const signOutItem = accountMenu.getByText(/sign out|登出/i);
      await expect(signOutItem).toBeVisible({ timeout: BUDGET.INTERACTIVE });

      await signOutItem.click();

      // Wait for the sign-out server action POST to complete before polling.
      // Without this, page.goto('/') inside the toPass loop cancels the in-flight
      // POST and the Set-Cookie headers never arrive, leaving the session active.
      await page.waitForLoadState("networkidle");

      // After sign-out, poll-reload home until the navbar reflects the logged-out state
      // (session-cookie clear + navbar re-render can lag the click).
      await expect(async () => {
        await page.goto("/");
        await expect(
          page.getByRole("link", { name: /sign in|登入/i }),
        ).toBeVisible();
        await expect(
          page.getByRole("button", { name: /account|帳號/i }),
        ).toHaveCount(0);
      }).toPass(POLL.UI);
    } finally {
      await context.close();
      // Always delete the disposable user — resilient to mid-test failures
      await deleteDisposableSignOutUser(supabase, disposableUserId);
    }
  });
});
