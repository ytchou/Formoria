import { expect, test } from "@playwright/test";

import { BUDGET } from "../budgets";

test.describe("Product catalog category navigation deep", () => {
  test("selecting a category navigates to its filtered view", async ({
    page,
  }) => {
    await page.goto("/discover");

    // The sidebar renders category filter links as a nav with the "all" label.
    const sidebar = page.locator("aside");
    const homeLink = sidebar.getByRole("link", { name: "居家生活" });
    await expect(homeLink).toBeVisible({ timeout: BUDGET.INTERACTIVE });
    await homeLink.click();

    await expect(page).toHaveURL(
      (url) =>
        url.pathname === "/discover" &&
        url.searchParams.get("category") === "home",
      { timeout: BUDGET.INTERACTIVE },
    );
  });

  test("active category is marked with aria-current and clearing returns to unfiltered", async ({
    page,
  }) => {
    await page.goto("/discover?category=home");

    const sidebar = page.locator("aside");
    const activeLink = sidebar.locator('[aria-current="page"]');
    await expect(activeLink).toHaveCount(1, { timeout: BUDGET.INTERACTIVE });

    // Clicking the "all" link clears the category filter.
    const allLink = sidebar.locator('[aria-current="page"]').first();
    // Find the "all" link — it's the one without a category param.
    const clearLink = sidebar
      .getByRole("link")
      .filter({ hasNot: page.locator('[aria-current="page"]') })
      .first();
    await clearLink.click();

    await expect(page).toHaveURL(
      (url) =>
        url.pathname === "/discover" && !url.searchParams.has("category"),
      { timeout: BUDGET.INTERACTIVE },
    );
  });
});
