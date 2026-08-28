import { load } from "cheerio";

import { BUDGET } from "../budgets";
import { test, expect } from "../fixtures/auth";
import {
  NO_PUBLISHED_TRAILS,
  publishedTrails,
  type PublishedTrail,
} from "../utils/published-trails";

const trails = publishedTrails("zh-TW");
// Index access, not `.at()`: `e2e/` is excluded from `tsconfig.json`, so the
// editor type-checks this file against default compiler options whose `lib`
// predates `Array.prototype.at`. The annotation is what keeps the empty-array
// case honest — `trails[0]` widens to `PublishedTrail` without
// `noUncheckedIndexedAccess`, and the `test.skip` below reads `undefined`.
const trail: PublishedTrail | undefined =
  trails.find((candidate) => candidate.sections.length >= 3) ?? trails[0];
const TRAIL_URL = trail ? `/style/${trail.slug}` : "/style";
// NO BADGE ON A TRAIL TILE ANY MORE (D11, DEV-1514). A trust label only says
// something where its opposite is visible, and every tile in a trail is
// selected — so the label was removed here rather than migrated into
// `TrustLabel`, whose text is the 選物 commitment and not the trail's own
// sentence. A trail tile is now identified the way it identifies itself: an
// anchor into the brand page at this product.
const PRODUCT_ANCHOR = 'a[href*="#product-"]';
const OFFICIAL_DESTINATION = /前往(?:產品|品牌)官方網站/;
const SECTION_NAV = "風格段落";
const REMOVED_CLOSING_HEADINGS = [
  "常見問題",
  "這一頁沒有放什麼",
  "探索相關分類",
];

test.describe("Discovery trail deep", () => {
  // DEV-1518 deleted the supply gate, so `/style/<slug>` no longer 404s for
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
    // The tiles themselves are in the server HTML, not just the section
    // scaffolding: every trail product carries its outbound destination, which
    // is the one piece of a tile a reader cannot get to any other way.
    expect(serverText).toMatch(OFFICIAL_DESTINATION);
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

  test.skip("visitor moves situation → section → product → brand page", async ({
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

    const sectionHeading = anonPage.getByRole("heading", {
      name: section.title,
      level: 2,
      exact: true,
    });
    await expect(sectionHeading).toBeVisible({ timeout: BUDGET.INTERACTIVE });

    // The tile is matched the way SelectedProductTile identifies itself: the h3
    // product name the next lines read, PLUS the anchor into the brand page at
    // that product. "Any listitem containing an h3" would also match an
    // unrelated card list and make `.first()` pick a tile with no product href
    // — the anchor filter is what rules that out, and unlike the badge it used
    // to filter on, it is the thing the next assertions actually follow.
    const productTile = anonPage
      .getByRole("listitem")
      .filter({ has: anonPage.getByRole("heading", { level: 3 }) })
      .filter({ has: anonPage.locator(PRODUCT_ANCHOR) })
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

  test("trail renders sections without redundant section navigation", async ({
    anonPage,
  }) => {
    const response = await anonPage.goto(TRAIL_URL);
    test.skip(response?.status() === 503, "PREVIEW_MODE active");

    const section = trail?.sections.at(1);
    test.skip(!section, "published trail has fewer than two sections");
    await expect(
      anonPage.getByRole("navigation", { name: SECTION_NAV }),
    ).toHaveCount(0);
    for (const heading of REMOVED_CLOSING_HEADINGS) {
      await expect(
        anonPage.getByRole("heading", { name: heading, exact: true }),
      ).toHaveCount(0);
    }
    await expect(
      anonPage.getByRole("heading", {
        name: section?.title ?? "",
        level: 2,
        exact: true,
      }),
    ).toBeVisible({ timeout: BUDGET.SERVER_RENDER });
  });

  test("hub lists the published trail", async ({ anonPage }) => {
    const response = await anonPage.goto("/style");
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
