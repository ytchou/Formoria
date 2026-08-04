import { test, expect } from "@playwright/test";

test.describe("Landing search compatibility", () => {
  test("@cross-browser landing search reaches sortable matching directory results", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const searchbox = page.locator(
      'main form[role="search"] input[role="searchbox"]',
    );
    await expect(searchbox).toBeVisible({ timeout: 10_000 });
    await searchbox.pressSequentially("coffee", { delay: 50 });
    await searchbox.press("Enter");

    await expect(page).toHaveURL(/\/brands\?search=coffee/, {
      timeout: 15_000,
    });
    const matchingResults = page.locator('main a[href^="/brands/"]');
    await expect(matchingResults.first()).toBeVisible({ timeout: 15_000 });
    expect(await matchingResults.count()).toBeGreaterThan(0);

    const sortSelect = page.getByRole("combobox", { name: "排序方式" });
    await expect(sortSelect).toBeVisible({ timeout: 10_000 });
    await sortSelect.selectOption("name");

    await expect(page).toHaveURL(/\/brands\?search=coffee&sort=name/, {
      timeout: 15_000,
    });
    await expect(sortSelect).toHaveValue("name");
    await expect(matchingResults.first()).toBeVisible({ timeout: 15_000 });
  });
});
