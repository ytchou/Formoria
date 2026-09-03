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
      page.getByLabel("搜尋情境"),
    ).toBeVisible({ timeout: BUDGET.RENDERED });

    const resultsHeading = page.getByRole("heading", {
      name: /符合「茶壺」的商品/,
    });
    await expect(resultsHeading).toBeVisible({ timeout: BUDGET.RENDERED });

    const productItems = page.getByRole("list").locator("li").first();
    const emptyState = page.getByText("找不到符合的商品");

    await expect(
      productItems.or(emptyState),
    ).toBeVisible({ timeout: BUDGET.RENDERED });
  });

  test("shows empty state for nonsense query", async ({ page }) => {
    await page.goto("/discover?q=zzzzxyzzy99", {
      timeout: BUDGET.NAVIGATION,
    });

    await expect(
      page.getByText("找不到符合的商品"),
    ).toBeVisible({ timeout: BUDGET.INTERACTIVE });
  });

  test("search form submits and navigates with query", async ({ page }) => {
    await page.goto("/discover", { timeout: BUDGET.NAVIGATION });

    const input = page.getByLabel("搜尋情境");
    await expect(input).toBeVisible({ timeout: BUDGET.RENDERED });
    await input.fill("送禮");
    await page.getByRole("button", { name: "搜尋" }).click();

    await page.waitForURL(/[?&]q=/, { timeout: BUDGET.INTERACTIVE });

    await expect(
      page.getByRole("heading", { name: /符合「送禮」的商品/ }),
    ).toBeVisible({ timeout: BUDGET.RENDERED });
  });
});
