import { test, expect } from "../fixtures/auth";

import { BUDGET } from "../budgets";
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
});
