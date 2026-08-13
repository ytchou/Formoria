import { BUDGET } from "../budgets";
import { test, expect } from "@playwright/test";
import { seedBrand, type SeededBrand } from "../helpers/seed";

test.describe("Landing search compatibility", () => {
  let seeded: SeededBrand;

  test.beforeAll(async ({}, workerInfo) => {
    seeded = await seedBrand({
      name: "cross-browser-search",
      workerIndex: workerInfo.workerIndex,
    });
  });

  test.afterAll(async () => {
    await seeded.cleanup();
  });

  test("@cross-browser landing search reaches sortable matching directory results", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "從自己想要的生活出發，找到適合的台灣產品",
      }),
    ).toBeVisible({ timeout: BUDGET.SERVER_RENDER });

    const searchbox = page.locator(
      'main form[role="search"] input[role="searchbox"]',
    );
    await expect(searchbox).toBeVisible({ timeout: BUDGET.INTERACTIVE });
    await searchbox.pressSequentially(seeded.brand.name, { delay: 10 });
    await searchbox.press("Enter");

    await expect(page).toHaveURL(
      (url) =>
        url.pathname === "/brands" &&
        url.searchParams.get("search") === seeded.brand.name,
      {
        timeout: BUDGET.SERVER_RENDER,
      },
    );
    const matchingResult = page.locator(
      `main a[href="/brands/${seeded.slug}"]`,
    );
    await expect(matchingResult).toBeVisible({ timeout: BUDGET.SERVER_RENDER });

    const sortSelect = page.getByRole("combobox", { name: "排序方式" });
    await expect(sortSelect).toBeVisible({ timeout: BUDGET.INTERACTIVE });
    await expect(sortSelect).toHaveValue("random");
    await sortSelect.selectOption("name");

    await expect(page).toHaveURL(
      (url) =>
        url.pathname === "/brands" &&
        url.searchParams.get("search") === seeded.brand.name &&
        url.searchParams.get("sort") === "name",
      { timeout: BUDGET.SERVER_RENDER },
    );
    await expect(sortSelect).toHaveValue("name");
    await expect(matchingResult).toBeVisible({ timeout: BUDGET.SERVER_RENDER });
  });
});
