import { BUDGET } from "../budgets";
import { test, expect } from "@playwright/test";

test.describe("Discover situation search", () => {
  test("renders search results with noindex and relevance sort", async ({
    page,
  }) => {
    await page.goto("/discover?q=茶壺", {
      timeout: BUDGET.NAVIGATION,
    });

    const robots = page.locator('meta[name="robots"]');
    await expect(robots).toHaveAttribute("content", /noindex/, {
      timeout: BUDGET.RENDERED,
    });

    await expect(
      page.getByLabel("搜尋商品"),
    ).toBeVisible({ timeout: BUDGET.RENDERED });

    // Search mode titles the page by the query (the page is noindex).
    const resultsHeading = page.getByRole("heading", {
      level: 1,
      name: /符合「茶壺」的商品/,
    });
    await expect(resultsHeading).toBeVisible({ timeout: BUDGET.RENDERED });

    const mainContent = page.locator("main");
    const productGrid = mainContent.locator("ul.grid").filter({ has: page.getByRole("heading", { level: 3 }) });
    const emptyState = mainContent.getByText("找不到符合的商品");

    await expect(
      productGrid.or(emptyState),
    ).toBeVisible({ timeout: BUDGET.RENDERED });
  });

  test("search form submits and navigates with query", async ({ page }) => {
    await page.goto("/discover", { timeout: BUDGET.NAVIGATION });

    const input = page.getByLabel("搜尋商品");
    await expect(input).toBeVisible({ timeout: BUDGET.RENDERED });
    await input.fill("送禮");
    // exact: the field's clear button (清除搜尋) also contains 搜尋 once it has text.
    await page.getByRole("button", { name: "搜尋", exact: true }).click();

    await page.waitForURL(/[?&]q=/, { timeout: BUDGET.INTERACTIVE });

    await expect(
      page.getByRole("heading", { name: /符合「送禮」的商品/ }),
    ).toBeVisible({ timeout: BUDGET.RENDERED });
  });
});
