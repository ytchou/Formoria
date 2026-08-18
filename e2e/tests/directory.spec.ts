import { PRODUCT_TYPE_CATEGORIES } from "../../src/lib/taxonomy/ontology";
import zhTW from "../../messages/zh-TW.json";
import { BUDGET } from "../budgets";
import { test, expect, type Page } from "@playwright/test";

/**
 * Three named L1 categories, resolved from the taxonomy the sidebar itself renders.
 *
 * This loop used to walk `getByRole("checkbox").nth(i)` for i in 1..3, which meant
 * the subject of every iteration was "whatever the taxonomy happens to put third" —
 * while the L2 taxonomy cleanup program is actively reshaping that list. A reorder
 * silently changed what was covered, and an L2 chip appearing among the checkboxes
 * changed it again (DEV-1414).
 */
const FILTER_SUBJECTS = ["fashion", "home", "crafts"].map((slug) => {
  const category = PRODUCT_TYPE_CATEGORIES.find((item) => item.slug === slug);
  if (!category) {
    // A renamed or removed L1 slug must break this loudly. Falling back to a
    // positional pick is how the drift went unnoticed in the first place.
    throw new Error(
      `directory spec pins a category that no longer exists: ${slug}`,
    );
  }
  return category;
});

/**
 * The result count the directory publishes ("共 N 個品牌", `brands.count`).
 * It is the one number that is a *positive* fact about a filtered request, so
 * a filter that quietly returns nothing has to move it. Read from `main`
 * rather than from the live region, because the region role is only attached
 * on category routes (`announceLiveRegion={isCategoryRoute}`).
 */
async function readAnnouncedCount(page: Page): Promise<number> {
  const status = page.locator("main").getByText(/共 \d+ 個品牌/).first();
  await expect(status).toBeVisible({ timeout: BUDGET.RENDERED });
  const matched = (await status.innerText()).match(/共 (\d+) 個品牌/);
  expect(matched).not.toBeNull();
  return Number(matched![1]);
}

test.describe("Directory deep", () => {
  test("each category filter narrows the directory to a non-empty result set", async ({
    page,
  }) => {
    await page.goto("/brands");
    // Baseline: every filtered request below must return fewer brands than
    // this, and more than zero. The old form accepted the empty state as an
    // alternative, so a filter returning nothing for every category — the
    // exact regression this test names — passed.
    const unfilteredCount = await readAnnouncedCount(page);
    expect(unfilteredCount).toBeGreaterThan(0);

    // The sidebar is the one named `filters.title`; `page.locator("aside")`
    // alone also matched the mobile filter sheet's aside once it existed.
    const sidebar = page.getByRole("complementary", {
      name: zhTW.brands.filters.title,
    });
    const categoryToggle = sidebar.getByRole("button", {
      name: zhTW.brands.filters.category,
      exact: true,
    });
    await categoryToggle.click();
    await expect(categoryToggle).toHaveAttribute("aria-expanded", "true");

    for (const category of FILTER_SUBJECTS) {
      // Selecting a category navigates to its dedicated taxonomy URL, and
      // deselecting navigates back to the plain directory — both are full
      // route changes that remount the sidebar and collapse this section.
      if ((await categoryToggle.getAttribute("aria-expanded")) !== "true") {
        await categoryToggle.click();
        await expect(categoryToggle).toHaveAttribute("aria-expanded", "true");
      }
      // Each checkbox carries `aria-label={categoryLabel(category)}`, so the
      // zh-TW name is its accessible name on the prefix-free directory.
      const filter = sidebar.getByRole("checkbox", {
        name: category.nameZh,
        exact: true,
      });
      await filter.click();
      // Selecting is a route change that remounts the sidebar; wait for the
      // filtered render before reading its count.
      await expect(filter).toBeChecked({ timeout: BUDGET.RENDERED });

      const filteredCount = await readAnnouncedCount(page);
      // A category with no seeded supply is a data state, not a filter bug —
      // but it is stated as an explicit skip so it is reported, instead of an
      // `.or(emptyState)` that would swallow a genuinely broken filter too.
      test.skip(
        filteredCount === 0,
        `No brands are seeded under ${category.slug} at the current supply gate.`,
      );
      expect(filteredCount).toBeLessThan(unfilteredCount);
      await expect(
        page.locator('main [role="list"] [role="listitem"]').first(),
      ).toBeVisible({ timeout: BUDGET.RENDERED });

      await filter.click(); // deselect
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

  test("category landing loads with filtered brands", async ({ page }) => {
    const response = await page.goto("/categories/home");
    expect(response?.status()).toBe(200);
    // `home` is a launch category, so an empty result here is a regression,
    // not a data state — asserted as real brands rather than "results OR the
    // empty state", which passed on both.
    const announced = await readAnnouncedCount(page);
    expect(announced).toBeGreaterThan(0);
    await expect(
      page.locator('main [role="list"] [role="listitem"]').first(),
    ).toBeVisible({ timeout: BUDGET.INTERACTIVE });
  });

  test("empty search shows empty state not error", async ({ page }) => {
    await page.goto("/brands");
    const search = page
      .locator('form[role="search"] input[role="searchbox"]:visible')
      .first();
    await search.fill("zzzzzzzzzzzzz_nonexistent");
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-empty]")).toBeVisible({
      timeout: BUDGET.RENDERED,
    });
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
