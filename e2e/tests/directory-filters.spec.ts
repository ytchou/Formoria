import { BUDGET, POLL } from "../budgets";
import { test, expect, type Locator, type Page } from "@playwright/test";

/**
 * Sidebar filter behaviour on the two catalogs: /discover (products) and
 * /brands (directory).
 *
 * The staging catalog is a stale snapshot whose taxonomy is still being
 * reshaped, so nothing here names an option, slug, brand or count. Every
 * subject is read from what the page renders — the first 子分類 option, the
 * first brand card — and every URL claim goes through `searchParams`.
 */

const DISCOVER_FILTERS = "篩選商品";
const BRANDS_FILTERS = "篩選";

function filterNav(page: Page, name: string): Locator {
  return page.getByRole("navigation", { name, exact: true });
}

/** A labelled filter group (分類 / 子分類 / 材質) inside a filter surface. */
function filterGroup(scope: Locator, name: string): Locator {
  return scope.getByRole("group", { name, exact: true });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Option rows read "家具\n68" — the label, then its facet count. */
function optionLabel(rowText: string): string {
  return rowText.split("\n")[0].replace(/\s*\d+\s*$/, "").trim();
}

/** A checkbox by its visible label; its accessible name also carries the count. */
function optionByLabel(group: Locator, label: string): Locator {
  return group.getByRole("checkbox", {
    name: new RegExp(`^${escapeRegExp(label)}\\s*\\d*$`),
  });
}

async function firstOptionLabel(group: Locator): Promise<string> {
  const row = group.locator("label").filter({ visible: true }).first();
  await expect(row).toBeVisible({ timeout: BUDGET.SERVER_RENDER });
  return optionLabel(await row.innerText());
}

/**
 * Clicks until the URL satisfies `predicate`. A click that lands before
 * hydration toggles the native checkbox without navigating, so the click is
 * repeated only while the URL still says it has not happened.
 */
async function clickUntilUrl(
  page: Page,
  target: Locator,
  predicate: (url: URL) => boolean,
): Promise<void> {
  await expect(async () => {
    if (!predicate(new URL(page.url()))) await target.click();
    await expect(page).toHaveURL(predicate, { timeout: BUDGET.INTERACTIVE });
  }).toPass(POLL.NAVIGATION);
}

/** Opens the group's 「再顯示 N 項」 truncation, if it has one. */
async function expandGroup(group: Locator): Promise<void> {
  const more = group.getByRole("button", { name: /^再顯示 \d+ 項$/ });
  const less = group.getByRole("button", { name: "顯示較少", exact: true });
  if (!(await more.isVisible())) return;
  await expect(async () => {
    if (await more.isVisible()) await more.click();
    await expect(less).toBeVisible({ timeout: BUDGET.RENDERED });
  }).toPass(POLL.UI);
}

/** Every option label in a group, sorted, with any truncation expanded. */
async function allOptionLabels(group: Locator): Promise<string[]> {
  await expect(group.locator("label").first()).toBeVisible({
    timeout: BUDGET.SERVER_RENDER,
  });
  await expandGroup(group);
  const rows = await group.locator("label").filter({ visible: true }).allInnerTexts();
  return rows.map(optionLabel).sort();
}

/** The first group among `names` that truncates its options, or null. */
async function findTruncatedGroup(
  nav: Locator,
  names: string[],
): Promise<{ name: string; group: Locator } | null> {
  for (const name of names) {
    const group = filterGroup(nav, name);
    if (await group.getByRole("button", { name: /^再顯示 \d+ 項$/ }).isVisible()) {
      return { name, group };
    }
  }
  return null;
}

async function firstBrandName(page: Page): Promise<string> {
  const heading = page
    .locator('main [role="list"] [role="listitem"]')
    .first()
    .getByRole("heading", { level: 3 });
  await expect(heading).toBeVisible({ timeout: BUDGET.SERVER_RENDER });
  return (await heading.innerText()).trim();
}

function brandSearch(page: Page): { box: Locator; submit: Locator } {
  const search = page.getByRole("main").getByRole("search", { name: "搜尋品牌" });
  return {
    box: search.getByRole("searchbox", { name: "搜尋品牌" }),
    // exact: the clear button (清除搜尋) also contains 搜尋 once the field has text.
    submit: search.getByRole("button", { name: "搜尋", exact: true }),
  };
}

const hasSub = (url: URL) => url.searchParams.has("sub");

const hasNoFilterKeys = (url: URL) =>
  url.pathname === "/brands" &&
  !url.searchParams.has("search") &&
  !url.searchParams.has("category") &&
  !url.searchParams.has("sub");

test.describe("Directory filters — 子分類 under 全部", () => {
  test("/discover: a 子分類 applies its parent category and drops the material filter", async ({
    page,
  }) => {
    await page.goto("/discover");
    const nav = filterNav(page, DISCOVER_FILTERS);

    // Start from a material filter with no category — the state the 子分類
    // pick has to reconcile.
    const material = filterGroup(nav, "材質");
    await expect(material.getByRole("checkbox").first()).toBeVisible({
      timeout: BUDGET.SERVER_RENDER,
    });
    await clickUntilUrl(page, material.getByRole("checkbox").first(), (url) =>
      url.searchParams.has("material"),
    );
    expect(new URL(page.url()).searchParams.has("category")).toBe(false);

    const subGroup = filterGroup(nav, "子分類");
    const chosen = await firstOptionLabel(subGroup);
    await clickUntilUrl(page, optionByLabel(subGroup, chosen), hasSub);

    const params = new URL(page.url()).searchParams;
    const parent = params.get("category");
    expect(parent, "a 子分類 pick must set its parent category").toBeTruthy();
    expect(params.get("sub")).toBeTruthy();
    expect(params.has("material"), "material must be dropped").toBe(false);

    // The parent is now the active category in the 分類 group.
    const active = filterGroup(nav, "分類").locator('[aria-current="page"]');
    await expect(active).toHaveCount(1, { timeout: BUDGET.RENDERED });
    await expect(active).toHaveAttribute(
      "href",
      new RegExp(`[?&]category=${escapeRegExp(String(parent))}(&|$)`),
    );
    await expect(optionByLabel(subGroup, chosen)).toBeChecked();

    // The 子分類 group now offers exactly the parent category's options.
    const scopedOptions = await allOptionLabels(subGroup);
    expect(scopedOptions).toContain(chosen);

    await page.goto(`/discover?category=${encodeURIComponent(String(parent))}`);
    const parentOptions = await allOptionLabels(
      filterGroup(filterNav(page, DISCOVER_FILTERS), "子分類"),
    );
    expect(scopedOptions).toEqual(parentOptions);
  });

  test("/brands: a 子分類 applies its parent category", async ({ page }) => {
    await page.goto("/brands");
    const nav = filterNav(page, BRANDS_FILTERS);
    const subGroup = filterGroup(nav, "子分類");
    const chosen = await firstOptionLabel(subGroup);

    await clickUntilUrl(page, optionByLabel(subGroup, chosen), hasSub);

    const params = new URL(page.url()).searchParams;
    const parent = params.get("category");
    expect(parent, "a 子分類 pick must set its parent category").toBeTruthy();
    expect(params.get("sub")).toBeTruthy();

    const active = filterGroup(nav, "分類").locator('[aria-current="page"]');
    await expect(active).toHaveCount(1, { timeout: BUDGET.RENDERED });
    await expect(active).toHaveAttribute(
      "href",
      new RegExp(`[?&]category=${escapeRegExp(String(parent))}(&|$)`),
    );
    await expect(optionByLabel(subGroup, chosen)).toBeChecked();
  });
});

test.describe("Directory filters — search combined with 子分類", () => {
  test("/discover search mode keeps the query when a 子分類 is picked", async ({
    page,
  }) => {
    // A 子分類 label is a real product noun, so it makes a search term with results.
    await page.goto("/discover");
    const term = await firstOptionLabel(
      filterGroup(filterNav(page, DISCOVER_FILTERS), "子分類"),
    );

    await page.goto(`/discover?q=${encodeURIComponent(term)}`);
    const heading = page.getByRole("heading", {
      level: 1,
      name: `符合「${term}」的商品`,
      exact: true,
    });
    await expect(heading).toBeVisible({ timeout: BUDGET.SERVER_RENDER });

    const subGroup = filterGroup(filterNav(page, DISCOVER_FILTERS), "子分類");
    await expect(subGroup).toBeVisible({ timeout: BUDGET.RENDERED });
    const chosen = await firstOptionLabel(subGroup);
    await clickUntilUrl(page, optionByLabel(subGroup, chosen), hasSub);

    const params = new URL(page.url()).searchParams;
    expect(params.get("q")).toBe(term);
    expect(params.get("category")).toBeTruthy();
    expect(params.get("sub")).toBeTruthy();
    await expect(heading).toBeVisible({ timeout: BUDGET.RENDERED });
  });

  test("/brands search keeps the search term when a 子分類 is picked", async ({
    page,
  }) => {
    await page.goto("/brands");
    const term = await firstBrandName(page);

    await page.goto(`/brands?search=${encodeURIComponent(term)}`);
    const subGroup = filterGroup(filterNav(page, BRANDS_FILTERS), "子分類");
    await expect(subGroup).toBeVisible({ timeout: BUDGET.SERVER_RENDER });
    const chosen = await firstOptionLabel(subGroup);
    await clickUntilUrl(page, optionByLabel(subGroup, chosen), hasSub);

    const params = new URL(page.url()).searchParams;
    expect(params.get("search")).toBe(term);
    expect(params.get("category")).toBeTruthy();
    expect(params.get("sub")).toBeTruthy();
  });
});

test.describe("Directory filters — 清除全部 on /brands", () => {
  test("desktop toolbar 清除全部 resets search, category and 子分類", async ({
    page,
  }) => {
    await page.goto("/brands");
    const term = await firstBrandName(page);

    const subGroup = filterGroup(filterNav(page, BRANDS_FILTERS), "子分類");
    const chosen = await firstOptionLabel(subGroup);
    await clickUntilUrl(page, optionByLabel(subGroup, chosen), hasSub);

    const { box, submit } = brandSearch(page);
    await box.fill(term);
    await submit.click();
    await expect(page).toHaveURL(
      (url) =>
        url.searchParams.get("search") === term &&
        url.searchParams.has("category") &&
        url.searchParams.has("sub"),
      { timeout: BUDGET.INTERACTIVE },
    );

    const main = page.getByRole("main");
    const chips = main.getByRole("link", { name: /^移除/ });
    await expect(
      main.getByRole("link", { name: `移除搜尋：${term}`, exact: true }),
    ).toBeVisible({ timeout: BUDGET.RENDERED });

    await main.getByRole("link", { name: "清除全部", exact: true }).click();

    await expect(page).toHaveURL(hasNoFilterKeys, {
      timeout: BUDGET.INTERACTIVE,
    });
    await expect(chips).toHaveCount(0, { timeout: BUDGET.RENDERED });
    await expect(box).toHaveValue("", { timeout: BUDGET.RENDERED });
  });

  test.describe("mobile", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("filter drawer 清除全部 resets search, category and 子分類", async ({
      page,
    }) => {
      await page.goto("/brands");
      const term = await firstBrandName(page);

      const { box, submit } = brandSearch(page);
      await box.fill(term);
      await submit.click();
      await expect(page).toHaveURL(
        (url) => url.searchParams.get("search") === term,
        { timeout: BUDGET.INTERACTIVE },
      );

      const trigger = page
        .getByRole("main")
        .getByRole("button", { name: "篩選", exact: true });
      const drawer = page.getByRole("dialog", { name: "篩選", exact: true });
      const openDrawer = async () => {
        await expect(async () => {
          if (!(await drawer.isVisible())) await trigger.click();
          await expect(drawer).toBeVisible({ timeout: BUDGET.INTERACTIVE });
        }).toPass(POLL.UI);
      };

      await openDrawer();
      const subGroup = filterGroup(drawer, "子分類");
      const chosen = await firstOptionLabel(subGroup);
      await clickUntilUrl(page, optionByLabel(subGroup, chosen), hasSub);
      expect(new URL(page.url()).searchParams.get("search")).toBe(term);
      expect(new URL(page.url()).searchParams.get("category")).toBeTruthy();

      // The drawer may or may not survive the navigation; reopen idempotently.
      await openDrawer();
      await drawer.getByRole("button", { name: "清除全部", exact: true }).click();

      await expect(page).toHaveURL(hasNoFilterKeys, {
        timeout: BUDGET.INTERACTIVE,
      });
    });
  });
});

test.describe("Directory filters — 再顯示 truncation", () => {
  test("a long filter group shows 10 options until expanded", async ({
    page,
  }) => {
    await page.goto("/discover");
    const nav = filterNav(page, DISCOVER_FILTERS);
    await expect(filterGroup(nav, "子分類").getByRole("checkbox").first()).toBeVisible({
      timeout: BUDGET.SERVER_RENDER,
    });

    const found = await findTruncatedGroup(nav, ["子分類", "材質"]);
    test.skip(
      found === null,
      "No /discover filter group has more than 11 options in the current catalog snapshot.",
    );
    const { group } = found!;

    const more = group.getByRole("button", { name: /^再顯示 \d+ 項$/ });
    await expect(more).toHaveAttribute("aria-expanded", "false");
    const hidden = Number((await more.innerText()).match(/\d+/)![0]);
    expect(hidden).toBeGreaterThan(1);

    // getByRole skips hidden elements: this counts what a user can see.
    const visibleOptions = group.getByRole("checkbox");
    await expect(visibleOptions).toHaveCount(10);

    await expect(async () => {
      if (await more.isVisible()) await more.click();
      await expect(
        group.getByRole("button", { name: "顯示較少", exact: true }),
      ).toBeVisible({ timeout: BUDGET.RENDERED });
    }).toPass(POLL.UI);

    const less = group.getByRole("button", { name: "顯示較少", exact: true });
    await expect(less).toHaveAttribute("aria-expanded", "true");
    await expect(visibleOptions).toHaveCount(10 + hidden);
  });
});
