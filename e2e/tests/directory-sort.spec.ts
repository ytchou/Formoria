import { BUDGET } from "../budgets";
import { test, expect } from "@playwright/test";

test.describe("Directory sort deep", () => {
  test("@smoke landing page renders the public directory entry point", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading").first()).toBeVisible({
      timeout: BUDGET.INTERACTIVE,
    });
    await expect(
      // Third owner of this assertion. DEV-1479 replaced the known-intent line
      // with the hero's browse CTA (開始逛逛); DEV-1514 then removed that CTA
      // with the whole search-and-grid opener — the homepage now opens
      // editorially and its search field is the hero's only control. The
      // directory link that survived is the one at the foot of the brand rail,
      // and it is matched by its /brands href rather than its copy so the next
      // rewrite of the wording does not silently empty this selector.
      page.getByRole("main").locator('a[href="/brands"]'),
    ).toBeVisible();
  });

  test('@smoke selecting "A-Z" updates URL to ?sort=name', async ({ page }) => {
    await page.goto("/brands");

    const sortSelect = page.getByRole("combobox", { name: "排序方式" });
    await expect(sortSelect).toBeVisible({ timeout: BUDGET.INTERACTIVE });
    await expect(sortSelect).toHaveValue("random");
    await expect(page).not.toHaveURL(/sort=/);

    await sortSelect.selectOption("name");

    await expect(page).toHaveURL(/sort=name/, { timeout: BUDGET.INTERACTIVE });
    await expect(page.locator("main a[aria-label]").first()).toBeVisible({
      timeout: BUDGET.INTERACTIVE,
    });
  });

  test('selecting "最新" preserves the category landing path', async ({
    page,
  }) => {
    await page.goto("/discover?category=home");

    const sortSelect = page.getByRole("combobox", { name: "排序方式" });
    await expect(sortSelect).toBeVisible({ timeout: BUDGET.INTERACTIVE });

    await sortSelect.selectOption("newest");

    await expect(page).toHaveURL(
      (url) =>
        url.pathname === "/discover" &&
        url.searchParams.get("category") === "home" &&
        url.searchParams.get("sort") === "newest",
      { timeout: BUDGET.INTERACTIVE },
    );
    await expect(page.locator("main a[aria-label]").first()).toBeVisible({
      timeout: BUDGET.INTERACTIVE,
    });
  });

  test('selecting "創立年份" updates URL to ?sort=year', async ({ page }) => {
    await page.goto("/brands");

    const sortSelect = page.getByRole("combobox", { name: "排序方式" });
    await expect(sortSelect).toBeVisible({ timeout: BUDGET.INTERACTIVE });

    await sortSelect.selectOption("year");

    await expect(page).toHaveURL(/sort=year/, { timeout: BUDGET.INTERACTIVE });
    await expect(page.locator("main a[aria-label]").first()).toBeVisible({
      timeout: BUDGET.INTERACTIVE,
    });
  });

  test('switching back to "隨機" removes sort param from URL', async ({
    page,
  }) => {
    await page.goto("/brands?sort=name");

    const sortSelect = page.getByRole("combobox", { name: "排序方式" });
    await expect(sortSelect).toBeVisible({ timeout: BUDGET.INTERACTIVE });
    await expect(sortSelect).toHaveValue("name");

    await sortSelect.selectOption("random");

    await expect(page).not.toHaveURL(/sort=/, { timeout: BUDGET.INTERACTIVE });
    await expect(page.locator("main a[aria-label]").first()).toBeVisible({
      timeout: BUDGET.INTERACTIVE,
    });
  });

  test('navigating to ?sort=newest pre-selects "最新" in the selector', async ({
    page,
  }) => {
    await page.goto("/brands?sort=newest");

    const sortSelect = page.getByRole("combobox", { name: "排序方式" });
    await expect(sortSelect).toBeVisible({ timeout: BUDGET.INTERACTIVE });
    await expect(sortSelect).toHaveValue("newest");
  });
});
