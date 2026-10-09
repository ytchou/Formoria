import { expect, test } from "@playwright/test";

import { BUDGET } from "../budgets";

test.describe("Product catalog category navigation deep", () => {
  test("selecting a category navigates to its filtered view", async ({
    page,
  }) => {
    await page.goto("/discover");

    // The categories are a chip row of links, led by the "all" chip.
    const chips = page.getByRole("navigation", { name: "分類", exact: true });
    const homeLink = chips.getByRole("link", { name: "居家生活" });
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

    const chips = page.getByRole("navigation", { name: "分類", exact: true });
    const activeLink = chips.locator('[aria-current="page"]');
    await expect(activeLink).toHaveCount(1, { timeout: BUDGET.INTERACTIVE });

    // Clicking the "all" link clears the category filter.
    const clearLink = chips
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
