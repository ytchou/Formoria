import { BUDGET } from "../budgets";
import { test, expect } from "@playwright/test";

test.describe("Directory deep", () => {
  test("all filter combinations return results or empty state", async ({
    page,
  }) => {
    await page.goto("/brands");
    const categoryToggle = page
      .locator("aside")
      .getByRole("button", { name: /分類|Category/ });
    await categoryToggle.click();
    await expect(categoryToggle).toHaveAttribute("aria-expanded", "true");
    const filters = page.getByRole("checkbox");
    const count = await filters.count();
    for (let i = 1; i < Math.min(count, 4); i++) {
      // Selecting a category navigates to its dedicated taxonomy URL, and
      // deselecting navigates back to the plain directory — both are full
      // route changes that remount the sidebar and collapse this section.
      if ((await categoryToggle.getAttribute("aria-expanded")) !== "true") {
        await categoryToggle.click();
        await expect(categoryToggle).toHaveAttribute("aria-expanded", "true");
      }
      await filters.nth(i).click();
      await expect(
        page
          .locator('main [role="list"] [role="listitem"]')
          .first()
          .or(page.locator("[data-empty]").first()),
      ).toBeVisible({ timeout: BUDGET.RENDERED });
      await filters.nth(i).click(); // deselect
    }
  });

  test("search autocomplete shows suggestions", async ({ page }) => {
    await page.route("**/api/search**", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          results: [
            {
              id: "directory-search-result",
              name: "Directory Search Result",
              slug: "directory-search-result",
              category: "crafts",
            },
          ],
        }),
      });
    });
    await page.goto("/brands");
    const search = page.locator(
      'header form[role="search"] input[role="searchbox"]:visible',
    );
    await search.fill("directory");
    await expect(
      page.getByRole("option", { name: /Directory Search Result/ }),
    ).toBeVisible();
  });

  test("pagination controls work", async ({ page }) => {
    await page.goto("/brands");
    const pagination = page.locator('nav[aria-label="Pagination"]');
    const nextLink = pagination.locator('a[aria-label="下一頁"]');
    if (!(await nextLink.isVisible())) return; // fewer than 2 pages of data — skip
    await nextLink.click();
    await expect(page).toHaveURL(/\/brands\?[^#]*page=2(?:&|$)/);
    const prevLink = page.locator(
      'nav[aria-label="Pagination"] a[aria-label="上一頁"]',
    );
    await expect(prevLink).toBeVisible({ timeout: BUDGET.INTERACTIVE });
  });

  test("category landing loads with filtered brands", async ({ page }) => {
    const response = await page.goto("/categories/home");
    expect(response?.status()).toBe(200);
    // The filtered directory renders brand list items or the recovery empty state.
    await expect(
      page
        .locator('main [role="list"] [role="listitem"]')
        .first()
        .or(page.locator("[data-empty]").first()),
    ).toBeVisible({ timeout: BUDGET.INTERACTIVE });
  });

  test("empty search shows empty state not error", async ({ page }) => {
    await page.goto("/brands");
    const search = page
      .locator('form[role="search"] input[role="searchbox"]:visible')
      .first();
    await search.fill("zzzzzzzzzzzzz_nonexistent");
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-empty]")).toBeVisible({ timeout: BUDGET.RENDERED });
  });

  test("empty filtered search shows empty state without recovery actions", async ({
    page,
  }) => {
    await page.goto(
      "/brands?search=zzzzzzzzzzzzz_nonexistent&category=jewelry",
    );

    const emptyState = page.locator("[data-empty]");
    await expect(
      emptyState.getByRole("heading", { name: "找不到符合的品牌" }),
    ).toBeVisible();

    await expect(
      emptyState.getByRole("link", { name: /移除品牌關鍵字/ }),
    ).not.toBeVisible();
  });
});
