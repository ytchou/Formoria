import { test, expect, type Locator, type Page } from "@playwright/test";

import { BUDGET } from "../budgets";
import { seedBrand, type SeededBrand } from "../helpers/seed";

/**
 * The hero's search field is the homepage's primary entry into the directory
 * after the DEV-1479 recut: the photograph-free hero carries exactly one search
 * control, and `landing-search-cross-browser.spec.ts` covers the OTHER field —
 * the one already on `/brands`, which rewrites the URL in place. This file
 * covers the cross-page journey the redesign introduced, where a submit leaves
 * `/` entirely via `window.location.href` (`search-input.tsx` uses a native
 * navigation here because `router.push` intermittently drops the transition in
 * WebKit).
 *
 * The keyboard case is not a duplicate of the first. DEV-1514 moved the category
 * nav out of the hero and into the persistent header, so those links now sit
 * BEFORE this field in the tab order rather than after it — the number of stops
 * in front of it moves with both the header and the taxonomy, and a control that
 * only a mouse can reach would still pass every assertion in the mouse case.
 */

/**
 * `landing.hero.searchLabel`, which is what distinguishes the hero form from the
 * header's own `SearchInput` (`brands.search.aria`, "搜尋品牌"). Both are
 * `role="search"` landmarks on `/`, and `getByRole` name matching is a substring
 * match, so the hero must be addressed by the longer, unique string.
 */
const HERO_SEARCH_LABEL = "搜尋台灣品牌與產品";

/**
 * Upper bound on tab stops between the document start and the hero field. It is
 * a countable DOM property, not a wait: the skip link, the header's controls and
 * the hero's own field all sit inside it. Exceeding it means the field moved
 * behind something new — a focus trap, or a widget that swallows Tab.
 *
 * Raised 25 → 40 on 2026-08-20. DEV-1514 stopped suppressing the category nav
 * on `/` (D1/D18 moved the categories out of the hero and into the persistent
 * header), which put its links ahead of this field. Measured against deployed
 * staging at revision 68bd90e0: **26**. The headroom is deliberate — the nav
 * renders one row per L1 category, so the true count moves with the taxonomy
 * and a bound sitting one stop above the measurement would fail on the next
 * category rather than on a real regression. A focus trap still fails here,
 * because a trap never reaches the field at any bound.
 */
const MAX_TAB_STOPS = 40;

/**
 * The searchbox is client-only: `SearchInput` reads `useSearchParams`, so under
 * the page's `revalidate = 3600` prerender the Suspense FALLBACK is what ships in
 * the server HTML — `role="searchbox"` appears nowhere in it. Waiting for the
 * field to exist is therefore a real hydration gate, not a paint wait, and it is
 * what keeps the typing below out of the pre-hydration window where React would
 * re-render the input from its own empty state and wipe the query.
 */
async function hydratedHeroSearchbox(page: Page): Promise<Locator> {
  const searchbox = page
    .getByRole("search", { name: HERO_SEARCH_LABEL })
    .getByRole("searchbox");
  await expect(searchbox).toBeVisible({ timeout: BUDGET.SERVER_RENDER });
  return searchbox;
}

/** Press Tab until `target` holds focus, or until the bound above is spent. */
async function tabUntilFocused(page: Page, target: Locator): Promise<void> {
  for (let stop = 0; stop < MAX_TAB_STOPS; stop += 1) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((el) => el === document.activeElement)) return;
  }
}

/** The directory route carrying the submitted query, as a URL predicate. */
function directoryResultsUrl(seeded: SeededBrand): (url: URL) => boolean {
  return (url) =>
    url.pathname === "/brands" &&
    url.searchParams.get("search") === seeded.brand.name;
}

test.describe("Homepage hero search", () => {
  let seeded: SeededBrand;

  test.beforeAll(async ({}, workerInfo) => {
    seeded = await seedBrand({
      name: "homepage-search",
      workerIndex: workerInfo.workerIndex,
    });
  });

  test.afterAll(async () => {
    await seeded.cleanup();
  });

  test("the hero search submits to the directory with the matching brand rendered", async ({
    page,
  }) => {
    test.setTimeout(BUDGET.TEST.JOURNEY);

    const response = await page.goto("/");
    test.skip(response?.status() === 503, "PREVIEW_MODE active");

    const searchbox = await hydratedHeroSearchbox(page);
    await searchbox.pressSequentially(seeded.brand.name, { delay: 10 });
    await searchbox.press("Enter");

    await expect(page).toHaveURL(directoryResultsUrl(seeded), {
      timeout: BUDGET.NAVIGATION,
    });
    // Rendered results, not just the route: `getBrands`' search branch is
    // deliberately exempt from `excludeTestBrands()` so an [E2E-TEST] brand stays
    // reachable by exact name (scripts/check-test-brand-filter.mjs pins that
    // exemption), which is what makes this assertion deterministic.
    await expect(
      page.locator(`main a[href="/brands/${seeded.slug}"]`),
    ).toBeVisible({ timeout: BUDGET.SERVER_RENDER });
  });

  test("the same journey completes by keyboard alone", async ({ page }) => {
    test.setTimeout(BUDGET.TEST.JOURNEY);

    const response = await page.goto("/");
    test.skip(response?.status() === 503, "PREVIEW_MODE active");

    const searchbox = await hydratedHeroSearchbox(page);

    // No click, and no `locator.press` — either would focus the field for us and
    // prove nothing. Tab from where the document actually starts.
    await tabUntilFocused(page, searchbox);
    await expect(
      searchbox,
      `the hero search field was not reachable within ${MAX_TAB_STOPS} tab stops`,
    ).toBeFocused();

    await page.keyboard.type(seeded.brand.name, { delay: 10 });
    // The typeahead is open by now. Enter with no suggestion highlighted must
    // submit the form rather than follow the first suggestion — the two branches
    // land on different routes (`handleSubmit` vs `handleSelect`), and only the
    // submit branch reaches a results page.
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(directoryResultsUrl(seeded), {
      timeout: BUDGET.NAVIGATION,
    });
    await expect(
      page.locator(`main a[href="/brands/${seeded.slug}"]`),
    ).toBeVisible({ timeout: BUDGET.SERVER_RENDER });
  });
});
