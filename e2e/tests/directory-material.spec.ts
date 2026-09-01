import { MATERIALS } from "../../src/lib/taxonomy/ontology";
import zhTW from "../../messages/zh-TW.json";
import { BUDGET } from "../budgets";
import { test, expect, type Page } from "@playwright/test";

/**
 * The `?material=` facet, which shipped with DEV-1510 and had no e2e coverage.
 *
 * Three separate defects were found here in review and every one was invisible
 * to unit tests, because each lived in the seam between the raw query string
 * and the parsed filter set: the sidebar fell back to the raw param and made
 * the facet unclearable; a second `hasFacet` predicate omitted `material`, so a
 * taxonomy click silently dropped it; and the ItemList JSON-LD was published on
 * a noindex filtered page. The tests below are anchored on that seam rather
 * than on the happy path.
 */
const MATERIAL = (() => {
  const material = MATERIALS.find((item) => item.slug === "wood");
  if (!material) {
    // Resolved from the ontology the sidebar itself renders, and loud if the
    // slug is ever retired — a positional or hardcoded pick is how the sibling
    // directory spec drifted before (DEV-1414).
    throw new Error("directory-material spec pins a material that no longer exists: wood");
  }
  return material;
})();

/** A slug that is not in the closed 12-material vocabulary. */
const INVALID_MATERIAL = "xyz";

/**
 * `brands.filters.removeFilter` is `移除{label}：{value}` — built here rather
 * than hardcoded so a copy change moves the selector with it.
 */
const REMOVE_MATERIAL_CHIP = zhTW.brands.filters.removeFilter
  .replace("{label}", zhTW.brands.filters.activeMaterial)
  .replace("{value}", MATERIAL.nameZh);

/**
 * Any active-filter chip, whatever its axis — the leading literal of
 * `removeFilter`, before its first placeholder. A page with a rejected facet
 * must carry none at all, not merely none for `material`.
 */
const ANY_REMOVE_CHIP = new RegExp(
  `^${zhTW.brands.filters.removeFilter.split("{")[0]}`,
);

/**
 * The result count the directory publishes ("共 N 個品牌", `brands.count`).
 *
 * Deliberately a local copy of the helper in `directory.spec.ts` rather than a
 * shared import: that spec is the DEV-1510 regression baseline and is meant to
 * keep passing untouched, so this file does not reach into it.
 */
async function readAnnouncedCount(page: Page): Promise<number> {
  const status = page.locator("main").getByText(/共 \d+ 個品牌/).first();
  await expect(status).toBeVisible({ timeout: BUDGET.RENDERED });
  const matched = (await status.innerText()).match(/共 (\d+) 個品牌/);
  expect(matched).not.toBeNull();
  return Number(matched![1]);
}

function sidebarOf(page: Page) {
  // The sidebar named `filters.title`; a bare `aside` also matches the mobile
  // filter sheet.
  return page.getByRole("complementary", { name: zhTW.brands.filters.title });
}

/**
 * The material checkbox's accessible name is `<name> <count>`, NOT just the
 * name: unlike the category checkboxes, the material count `<span>` is not
 * `aria-hidden`. Matching loosely on purpose — tightening this to
 * `exact: true` on the bare label is the obvious-looking "fix" that breaks it.
 */
const materialCheckboxName = new RegExp(`^${MATERIAL.nameZh}\\s+\\d+$`);

test.describe("Directory — material facet", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/brands");
    // Supply, not code, decides what renders here: an option whose brand count
    // is 0 is dropped before render. Guard on the PINNED option rather than on
    // the section — if another material has supply and `wood` does not, the
    // section still renders, and a section-level guard would let all three
    // tests through to time out on a checkbox that never resolves.
    const sidebar = sidebarOf(page);
    const materialToggle = sidebar.getByRole("button", {
      name: zhTW.brands.filters.material,
      exact: true,
    });
    if ((await materialToggle.count()) > 0) await materialToggle.click();
    test.skip(
      (await sidebar
        .getByRole("checkbox", { name: materialCheckboxName })
        .count()) === 0,
      `No approved brand carries the "${MATERIAL.slug}" material at the current supply gate.`,
    );
  });

  test("a material narrows the directory, and its chip clears it", async ({
    page,
  }) => {
    await page.goto("/brands");
    const unfilteredCount = await readAnnouncedCount(page);
    expect(unfilteredCount).toBeGreaterThan(0);

    await page.goto(`/brands?material=${MATERIAL.slug}`);

    const sidebar = sidebarOf(page);
    const materialToggle = sidebar.getByRole("button", {
      name: zhTW.brands.filters.material,
      exact: true,
    });
    // The section is `defaultOpen` when the facet is already active, so an
    // active filter must never be hidden behind a collapsed panel.
    await expect(materialToggle).toHaveAttribute("aria-expanded", "true");
    await expect(
      sidebar.getByRole("checkbox", { name: materialCheckboxName }),
    ).toBeChecked();

    const filteredCount = await readAnnouncedCount(page);
    expect(filteredCount).toBeGreaterThan(0);
    expect(filteredCount).toBeLessThan(unfilteredCount);

    // Clearing goes through the chip, which is the control that regressed when
    // the sidebar fell back to the raw URL param and made the facet unclearable.
    const chip = page.getByRole("link", { name: REMOVE_MATERIAL_CHIP });
    await expect(chip).toBeVisible();
    await chip.click();

    await expect(page).toHaveURL(/\/brands(\?.*)?$/);
    await expect(page).not.toHaveURL(/material=/);
    await expect(
      sidebarOf(page).getByRole("checkbox", { name: materialCheckboxName }),
    ).not.toBeChecked();
    expect(await readAnnouncedCount(page)).toBe(unfilteredCount);
  });

  test("the material filter survives a category selection", async ({ page }) => {
    await page.goto(`/brands?material=${MATERIAL.slug}`);

    const sidebar = sidebarOf(page);
    // Categories are now direct links in the new FilterSidebar — no collapsible
    // toggle. They are always visible; pick the first category link.
    const nav = sidebar.getByRole("navigation", {
      name: zhTW.brands.filters.title,
    });

    // `material` is an orthogonal axis, so a taxonomy selection must keep it and
    // stay on `/brands` rather than resolving to a bare `/categories/<l1>` path.
    // That path resolution is driven by a `hasFacet` predicate which once
    // omitted `material` entirely, silently dropping the filter on this click.
    // Skip the first link ("全部" / All) and click the first actual category.
    const firstCategory = nav.getByRole("link").nth(1);
    await firstCategory.click();

    await expect(page).toHaveURL(new RegExp(`material=${MATERIAL.slug}`), {
      timeout: BUDGET.RENDERED,
    });
    await expect(page).not.toHaveURL(/\/categories\//);
  });

  test("an unknown material renders no chip, no checked box, and no ItemList", async ({
    page,
  }) => {
    await page.goto("/brands");
    const unfilteredCount = await readAnnouncedCount(page);

    await page.goto(`/brands?material=${INVALID_MATERIAL}`);

    // The closed vocabulary drops the term server-side, so the page is the
    // unfiltered directory wearing a junk query string.
    await expect(page.getByRole("link", { name: ANY_REMOVE_CHIP })).toHaveCount(
      0,
    );
    await expect(
      sidebarOf(page).getByRole("checkbox", { name: materialCheckboxName }),
    ).not.toBeChecked();
    expect(await readAnnouncedCount(page)).toBe(unfilteredCount);

    // ...but it is still `noindex`, because the robots decision reads the RAW
    // query. The ItemList must follow that same decision. It used to read the
    // PARSED filters instead, so this exact URL shipped an ItemList naming
    // every approved brand while telling crawlers not to index the page it
    // described (DEV-1524).
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      /noindex/i,
    );
    const jsonLdBlocks = await page
      .locator('script[type="application/ld+json"]')
      .allTextContents();
    expect(jsonLdBlocks.some((block) => block.includes('"ItemList"'))).toBe(
      false,
    );
  });
});
