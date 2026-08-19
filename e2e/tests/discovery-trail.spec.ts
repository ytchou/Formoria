import { load } from "cheerio";

import { BUDGET } from "../budgets";
import { test, expect } from "../fixtures/auth";
import {
  NO_PUBLISHED_TRAILS,
  publishedTrails,
} from "../utils/published-trails";

const trails = publishedTrails("zh-TW");
const trail =
  trails.find((candidate) => candidate.sections.length >= 3) ?? trails.at(0);
const TRAIL_URL = trail ? `/discover/${trail.slug}` : "/discover";
// Not a per-product selection reason — DEV-1496 removed those. This is the
// generic badge `SelectedProductTile` renders beside the product description,
// from its `labels.selectedBadge` block, so it is still live on every trail
// tile.
const SELECTED_BADGE_LABEL = "為這個主題選入";
const OFFICIAL_DESTINATION = /前往(?:產品|品牌)官方網站/;

test.describe("Discovery trail deep", () => {
  // DEV-1518 deleted the supply gate, so `/discover/<slug>` no longer 404s for
  // a thin slate — a published trail renders and is indexed whatever its
  // product count. The 404 probe that used to skip here is gone with it: a 404
  // now means the slug is wrong or the MDX is missing, which is a red, not a
  // skip. `NO_PUBLISHED_TRAILS` stays — it guards an empty `content/trails/`.
  test.beforeEach(() => {
    test.skip(trail === undefined, NO_PUBLISHED_TRAILS);
  });

  test("trail entrance renders in server HTML", async ({ request }) => {
    const response = await request.get(TRAIL_URL);
    test.skip(response.status() === 503, "PREVIEW_MODE active");

    expect(response.status()).toBe(200);
    const $ = load(await response.text());
    const serverText = $("main").text();

    expect(serverText).toContain(trail!.title);
    for (const section of trail!.sections) {
      expect(serverText).toContain(section.title);
    }
    expect(serverText).toContain(SELECTED_BADGE_LABEL);
  });

  // The regression guard for DEV-1518. Before it, four frontmatter blockers,
  // two subcategory heuristics and a supply floor could each stamp
  // `noindex` on a published trail with no signal to its author. Nothing else
  // in the repo asserts trail robots meta, so this is the only thing standing
  // between that gate and a quiet return.
  test("published trail is not noindex", async ({ request }) => {
    const response = await request.get(TRAIL_URL);
    test.skip(response.status() === 503, "PREVIEW_MODE active");

    expect(response.status()).toBe(200);
    const $ = load(await response.text());

    const robots = $('meta[name="robots"]').attr("content") ?? "";
    expect(robots).not.toContain("noindex");
  });

  test("visitor moves situation → section → product → brand page", async ({
    anonPage,
  }) => {
    test.setTimeout(BUDGET.TEST.JOURNEY);
    const response = await anonPage.goto(TRAIL_URL);
    test.skip(response?.status() === 503, "PREVIEW_MODE active");

    await expect(
      anonPage.getByRole("heading", { name: trail!.title, level: 1 }),
    ).toBeVisible({ timeout: BUDGET.SERVER_RENDER });

    const section = trail?.sections.at(0);
    test.skip(!section, "published trail has no sections");
    await anonPage
      .getByRole("navigation", { name: "主題選物段落" })
      .getByRole("link", { name: section?.title ?? "", exact: true })
      .click();

    const sectionHeading = anonPage.getByRole("heading", {
      name: section.title,
      level: 2,
      exact: true,
    });
    await expect(sectionHeading).toBeVisible({ timeout: BUDGET.INTERACTIVE });

    // The tile is matched the way SelectedProductTile identifies itself: the h3
    // product name the next lines read, PLUS the selection badge it renders
    // beside every product description, from its `labels.selectedBadge` block
    // and asserted in server HTML above. "Any listitem containing an h3" would
    // also match an unrelated card list and make `.first()` pick a tile with no
    // product href — the badge filter is what rules that out.
    const productTile = anonPage
      .getByRole("listitem")
      .filter({ has: anonPage.getByRole("heading", { level: 3 }) })
      .filter({ hasText: SELECTED_BADGE_LABEL })
      .first();
    await expect(productTile).toBeVisible({ timeout: BUDGET.SERVER_RENDER });

    const productHeading = productTile.getByRole("heading", { level: 3 });
    const productName = (await productHeading.textContent())?.trim();
    expect(productName).toBeTruthy();
    const productLink = productTile.getByRole("link", {
      name: productName!,
      exact: true,
    });
    const destination = await productLink.getAttribute("href");
    expect(destination).toMatch(
      /^\/brands\/[a-z0-9][a-z0-9-]*#product-[a-z0-9][a-z0-9-]*$/,
    );

    await productLink.click();
    await expect(anonPage).toHaveURL(
      new RegExp(`${escapeRegExp(destination!)}$`),
      {
        timeout: BUDGET.NAVIGATION,
      },
    );
    await expect(
      anonPage.getByRole("heading", { name: productName!, level: 3 }),
    ).toBeVisible({ timeout: BUDGET.SERVER_RENDER });
  });

  test("outbound chip points at the brand's official destination", async ({
    anonPage,
  }) => {
    const response = await anonPage.goto(TRAIL_URL);
    test.skip(response?.status() === 503, "PREVIEW_MODE active");

    const outbound = anonPage
      .getByRole("link", { name: OFFICIAL_DESTINATION })
      .first();
    await expect(outbound).toBeVisible({ timeout: BUDGET.SERVER_RENDER });
    const href = await outbound.getAttribute("href");
    expect(href).toBeTruthy();
    expect(new URL(href!).protocol).toBe("https:");
    expect(new URL(href!).origin).not.toBe(new URL(anonPage.url()).origin);
  });

  test("anchor nav moves focus to the target section", async ({ anonPage }) => {
    const response = await anonPage.goto(TRAIL_URL);
    test.skip(response?.status() === 503, "PREVIEW_MODE active");

    const section = trail?.sections.at(1);
    test.skip(!section, "published trail has fewer than two sections");
    const targetHeading = anonPage.getByRole("heading", {
      name: section?.title ?? "",
      level: 2,
      exact: true,
    });
    await anonPage
      .getByRole("navigation", { name: "主題選物段落" })
      .getByRole("link", { name: section?.title ?? "", exact: true })
      .click();

    await expect(targetHeading).toBeFocused({ timeout: BUDGET.INTERACTIVE });
  });

  test("hub lists the published trail", async ({ anonPage }) => {
    const response = await anonPage.goto("/discover");
    test.skip(response?.status() === 503, "PREVIEW_MODE active");

    const trailHeading = anonPage.getByRole("heading", {
      name: trail!.title,
      level: 2,
      exact: true,
    });
    const trailLink = anonPage.getByRole("link").filter({ has: trailHeading });
    await expect(trailLink).toBeVisible({ timeout: BUDGET.SERVER_RENDER });
    await expect(trailLink).toHaveAttribute("href", TRAIL_URL);
  });
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
