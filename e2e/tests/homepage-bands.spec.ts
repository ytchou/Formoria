import { test, expect, type Page } from "@playwright/test";
import { BUDGET } from "../budgets";

/** The phone cap on the homepage selection band (DEV-1966). */
const PHONE_TILE_LIMIT = 6;

function selectionTiles(page: Page) {
  return page.locator(
    '[data-landing-zone="selection"] [data-category="all"] > ul > li',
  );
}

function trailItems(page: Page) {
  return page
    .locator('[data-landing-zone="trails"] ul')
    .first()
    .locator(":scope > li");
}

/**
 * DS-10 / DS-12: a wall tile's name sits in flow beneath its photograph at
 * rest (it used to be a hover-only scrim from `sm`), inset 12px from the
 * band's ground plate. Measured without hovering.
 */
async function measureWallCaption(page: Page) {
  const tile = selectionTiles(page).first();
  await tile.waitFor({ timeout: BUDGET.SERVER_RENDER });
  await tile.scrollIntoViewIfNeeded();

  const name = tile.getByRole("heading", { level: 3 });
  const [photoBox, nameBox] = await Promise.all([
    tile.locator("[data-wall-ratio]").boundingBox(),
    name.boundingBox(),
  ]);
  return {
    name,
    // In flow below the photo, not overlaid on it.
    belowPhoto:
      !!photoBox && !!nameBox && nameBox.y >= photoBox.y + photoBox.height - 1,
    inset: await name.evaluate((el) => {
      const style = getComputedStyle(el.parentElement!);
      return { left: style.paddingLeft, bottom: style.paddingBottom };
    }),
  };
}

test.describe("Homepage bands on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the selection band shows at most six tiles, two to a line", async ({
    page,
  }) => {
    await page.goto("/");
    const tiles = selectionTiles(page);
    await expect(tiles.first()).toBeVisible({ timeout: BUDGET.SERVER_RENDER });

    const visible = await tiles.evaluateAll(
      (items) => items.filter((li) => (li as HTMLElement).offsetParent).length,
    );
    expect(visible).toBeGreaterThan(0);
    expect(visible).toBeLessThanOrEqual(PHONE_TILE_LIMIT);

    // Two-up: the first two tiles share a line and each is under half the
    // viewport wide.
    const [first, second] = await Promise.all([
      tiles.nth(0).boundingBox(),
      tiles.nth(1).boundingBox(),
    ]);
    expect(first && second).toBeTruthy();
    expect(Math.abs(first!.y - second!.y)).toBeLessThan(2);
    expect(first!.width).toBeLessThan(390 / 2);

    // The see-all link still follows the capped band.
    await expect(
      page
        .locator('[data-landing-zone="selection"]')
        .getByRole("link", { name: "看全部商品" }),
    ).toBeVisible();
  });

  test("a selection tile shows its name at rest, below the photo", async ({
    page,
  }) => {
    await page.goto("/");
    const caption = await measureWallCaption(page);
    await expect(caption.name).toBeVisible();
    await expect(caption.name).not.toBeEmpty();
    expect(caption.belowPhoto).toBe(true);
    expect(caption.inset).toEqual({ left: "12px", bottom: "12px" });
  });

  test("the trail row lets the next trail peek in and counts position", async ({
    page,
  }) => {
    await page.goto("/");
    const items = trailItems(page);
    await expect(items.first()).toBeVisible({ timeout: BUDGET.SERVER_RENDER });

    // Staging publishes several trails; a single one would leave nothing to
    // peek, and that is worth failing loudly over rather than skipping.
    const count = await items.count();
    expect(count).toBeGreaterThan(1);

    const second = await items.nth(1).boundingBox();
    expect(second).toBeTruthy();
    // Part of the next card starts inside the 390px viewport.
    expect(second!.x).toBeLessThan(390);

    await expect(
      page
        .locator('[data-landing-zone="trails"]')
        .getByText(new RegExp(`^1 / ${count}$`)),
    ).toBeVisible();
  });
});

test.describe("Homepage bands on desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("the selection band is not capped and has no trail counter", async ({
    page,
  }) => {
    await page.goto("/");
    const tiles = selectionTiles(page);
    await expect(tiles.first()).toBeVisible({ timeout: BUDGET.SERVER_RENDER });

    const total = await tiles.count();
    const visible = await tiles.evaluateAll(
      (items) => items.filter((li) => (li as HTMLElement).offsetParent).length,
    );
    expect(visible).toBe(total);

    await expect(
      page.locator('[data-landing-zone="trails"]').getByText(/^1 \/ \d+$/),
    ).toBeHidden();
  });

  test("a selection tile shows its name at rest, below the photo", async ({
    page,
  }) => {
    await page.goto("/");
    const caption = await measureWallCaption(page);
    await expect(caption.name).toBeVisible();
    await expect(caption.name).not.toBeEmpty();
    expect(caption.belowPhoto).toBe(true);
    expect(caption.inset).toEqual({ left: "12px", bottom: "12px" });
  });

  // Only the "all" group is server-rendered; a category chip fetches its
  // tiles from /api/home-wall on first click (DEV-1972).
  test("a category chip loads that category's tiles in place", async ({
    page,
  }) => {
    await page.goto("/");
    const band = page.locator('[data-landing-zone="selection"]');
    await expect(selectionTiles(page).first()).toBeVisible({
      timeout: BUDGET.SERVER_RENDER,
    });
    await expect(band.locator('[data-category="home"]')).toHaveCount(0);

    const chip = band.getByRole("button", { name: "居家生活" });
    await chip.click();
    await expect(chip).toHaveAttribute("aria-pressed", "true");
    await expect(
      band.locator('[data-category="home"] > ul > li').first(),
    ).toBeVisible({ timeout: BUDGET.INTERACTIVE });
    await expect(band.locator('[data-category="all"]')).toBeHidden();

    await band.getByRole("button", { name: "全部" }).click();
    await expect(selectionTiles(page).first()).toBeVisible();
  });
});
