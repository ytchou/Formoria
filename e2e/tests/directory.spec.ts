import { VISIBLE_L1_CATEGORIES } from "../../src/lib/taxonomy/ontology";
import zhTW from "../../messages/zh-TW.json";
import { BUDGET, POLL } from "../budgets";
import { test, expect, type Locator, type Page } from "@playwright/test";

/**
 * How long the suggestion listbox must stay closed after a submit. Must exceed
 * the search field's 200ms suggestion debounce with margin: a debounced fetch
 * started by typing can resolve after the submit and reopen the listbox.
 */
const SUGGESTION_SETTLE_MS = 1_500;

/**
 * Asserts `locator` stays hidden for `windowMs`, polled on POLL.UI. Fails as
 * soon as one poll sees it visible — a listbox that flashes open and closes
 * again between polls is not caught, but one left open over the results is.
 */
async function expectStaysHidden(locator: Locator, windowMs: number) {
  const start = Date.now();
  let sawVisible = false;
  await expect
    .poll(async () => {
      sawVisible = sawVisible || (await locator.isVisible());
      if (sawVisible) return "visible";
      return Date.now() - start >= windowMs ? "settled" : "waiting";
    }, POLL.UI)
    .toBe("settled");
}

/**
 * Three named L1 categories, resolved from the taxonomy the sidebar itself renders.
 *
 * This loop used to walk `getByRole("checkbox").nth(i)` for i in 1..3, which meant
 * the subject of every iteration was "whatever the taxonomy happens to put third" —
 * while the L2 taxonomy cleanup program is actively reshaping that list. A reorder
 * silently changed what was covered, and an L2 chip appearing among the checkboxes
 * changed it again (DEV-1414).
 *
 * The third subject was `crafts` until DEV-1507 retired that L1; `stationery`
 * takes its place after food-drink was deferred. Counts stay read from the
 * page, so supply changes need no expectation update here.
 */
const FILTER_SUBJECTS = ["fashion", "home", "stationery"].map((slug) => {
  const category = VISIBLE_L1_CATEGORIES.find((item) => item.slug === slug);
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
  const status = page
    .locator("main")
    .getByText(/共 \d+ 個品牌/)
    .first();
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

    // The sidebar is rendered as a <nav> with aria-label matching filters.title.
    const sidebar = page.getByRole("navigation", {
      name: zhTW.brands.filters.title,
    });

    for (const category of FILTER_SUBJECTS) {
      // Categories are direct links in the new FilterSidebar — no collapsible
      // toggle. Clicking a category link navigates to its filtered URL; the
      // "All" link navigates back.
      const categoryLink = sidebar.getByRole("link", {
        name: category.nameZh,
        exact: true,
      });
      await categoryLink.click();
      // Wait for the filtered render by checking aria-current on the link.
      await expect(categoryLink).toHaveAttribute("aria-current", "page", {
        timeout: BUDGET.RENDERED,
      });

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

      // Navigate back to the unfiltered directory by clicking "All".
      const allLink = sidebar.getByRole("link", { name: zhTW.brands.filters.all, exact: true });
      await allLink.click();
      await expect(allLink).toHaveAttribute("aria-current", "page", {
        timeout: BUDGET.RENDERED,
      });
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
              category: "food-drink",
            },
          ],
        }),
      });
    });
    await page.goto("/brands");
    const search = page.getByRole("main").getByRole("search", { name: "搜尋品牌" }).getByRole("searchbox", { name: "搜尋品牌" });
    await search.fill("directory");
    await expect(
      page.getByRole("option", { name: /Directory Search Result/ }),
    ).toBeVisible();
  });

  test("category landing loads with filtered brands", async ({ page }) => {
    const response = await page.goto("/brands?category=home");
    expect(response?.status()).toBe(200);
    // The sitemap submits this URL, so the page must not noindex it (SP-03).
    await expect(
      page.locator('meta[name="robots"][content*="noindex"]'),
    ).toHaveCount(0);
    // `home` is a launch category, so an empty result here is a regression,
    // not a data state — asserted as real brands rather than "results OR the
    // empty state", which passed on both.
    const announced = await readAnnouncedCount(page);
    expect(announced).toBeGreaterThan(0);
    await expect(
      page.locator('main [role="list"] [role="listitem"]').first(),
    ).toBeVisible({ timeout: BUDGET.INTERACTIVE });
  });

  test("搜尋 button submits the term and leaves no suggestion list open", async ({
    page,
  }) => {
    await page.goto("/brands");
    // A brand the directory itself lists, so the term is real on any snapshot.
    const firstBrand = page
      .locator('main [role="list"] [role="listitem"]')
      .first()
      .getByRole("heading", { level: 3 });
    await expect(firstBrand).toBeVisible({ timeout: BUDGET.SERVER_RENDER });
    const term = (await firstBrand.innerText()).trim();

    const search = page.getByRole("main").getByRole("search", { name: "搜尋品牌" });
    await search.getByRole("searchbox", { name: "搜尋品牌" }).fill(term);
    // exact: the clear button (清除搜尋) also contains 搜尋 once the field has text.
    await search.getByRole("button", { name: "搜尋", exact: true }).click();

    await expect(page).toHaveURL(
      (url) => url.pathname === "/brands" && url.searchParams.get("search") === term,
      { timeout: BUDGET.INTERACTIVE },
    );
    await expectStaysHidden(page.getByRole("listbox"), SUGGESTION_SETTLE_MS);
  });

  test("opening a shared search link shows results without a suggestion list", async ({
    page,
  }) => {
    await page.goto("/brands");
    const firstBrand = page
      .locator('main [role="list"] [role="listitem"]')
      .first()
      .getByRole("heading", { level: 3 });
    await expect(firstBrand).toBeVisible({ timeout: BUDGET.SERVER_RENDER });
    const term = (await firstBrand.innerText()).trim();

    // A link someone shared, not a search the visitor typed: the listbox used
    // to open unfocused over the toolbar and ignore Escape.
    await page.goto(`/brands?search=${encodeURIComponent(term)}`);
    const search = page.getByRole("main").getByRole("search", { name: "搜尋品牌" });
    await expect(search.getByRole("searchbox", { name: "搜尋品牌" })).toHaveValue(term, {
      timeout: BUDGET.SERVER_RENDER,
    });
    await expectStaysHidden(page.getByRole("listbox"), SUGGESTION_SETTLE_MS);
    await expect(
      page.getByRole("main").getByRole("link", { name: "清除全部" }),
    ).toBeVisible({ timeout: BUDGET.INTERACTIVE });
  });

  test("empty search shows empty state not error", async ({ page }) => {
    await page.goto("/brands");
    const search = page.getByRole("main").getByRole("search", { name: "搜尋品牌" }).getByRole("searchbox", { name: "搜尋品牌" });
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
      emptyState.getByRole("heading", { name: "沒有符合這些條件的品牌" }),
    ).toBeVisible();

    await expect(
      emptyState.getByRole("link", { name: /移除品牌關鍵字/ }),
    ).not.toBeVisible();
  });
});
