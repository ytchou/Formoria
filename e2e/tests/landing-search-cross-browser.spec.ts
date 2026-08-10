import { BUDGET } from "../budgets";
import { test, expect } from "@playwright/test";

test.describe("Landing search compatibility", () => {
  test("@cross-browser landing search reaches sortable matching directory results", async ({
    page,
  }) => {
    await page.goto("/");

    const searchbox = page.locator(
      'main form[role="search"] input[role="searchbox"]',
    );
    await expect(searchbox).toBeVisible({ timeout: BUDGET.INTERACTIVE });
    await searchbox.pressSequentially("coffee", { delay: 50 });
    await searchbox.press("Enter");

    await expect(page).toHaveURL(/\/brands\?search=coffee/, {
      timeout: BUDGET.SERVER_RENDER,
    });
    const matchingResults = page.locator('main a[href^="/brands/"]');
    await expect(matchingResults.first()).toBeVisible({ timeout: BUDGET.SERVER_RENDER });
    expect(await matchingResults.count()).toBeGreaterThan(0);

    const sortSelect = page.getByRole("combobox", { name: "排序方式" });
    await expect(sortSelect).toBeVisible({ timeout: BUDGET.INTERACTIVE });
    await expect(sortSelect).toHaveValue("random");
    await sortSelect.selectOption("name");

    await expect(page).toHaveURL(/\/brands\?search=coffee&sort=name/, {
      timeout: BUDGET.SERVER_RENDER,
    });
    await expect(sortSelect).toHaveValue("name");
    await expect(matchingResults.first()).toBeVisible({ timeout: BUDGET.SERVER_RENDER });
  });
});
