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
const SIMILAR_PRODUCTS_TRAIL_URL = "/style/small-space-reading-corner";
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

  test("explore-more section renders when similar products exist", async ({
    request,
  }) => {
    const response = await request.get(SIMILAR_PRODUCTS_TRAIL_URL);
    test.skip(response.status() === 503, "PREVIEW_MODE active");

    expect(response.status()).toBe(200);
    const $ = load(await response.text());
    const exploreSection = $('section[aria-label="再逛逛類似的商品"]');
    expect(exploreSection).toHaveLength(1);
    expect(exploreSection.find("h2").text()).toBe("再逛逛類似的商品");
    expect(exploreSection.find("li").length).toBeGreaterThanOrEqual(3);
  });

  // DEV-1967: related trails used to print their raw slugs. They now resolve
  // to published trails and render as tiles named by title; a draft or missing
  // slug is dropped rather than shown.
  test("related trails render by title, never by raw slug", async ({
    request,
  }) => {
    const publishedBySlug = new Map(trails.map((entry) => [entry.slug, entry]));
    const withRelated = trails.find((candidate) =>
      candidate.relatedTrails.some((related) => publishedBySlug.has(related)),
    );
    test.skip(!withRelated, "no published trail links a published trail");

    const response = await request.get(`/style/${withRelated!.slug}`);
    test.skip(response.status() === 503, "PREVIEW_MODE active");

    expect(response.status()).toBe(200);
    const $ = load(await response.text());
    const section = $('section[aria-labelledby="trails-related"]');
    expect(section).toHaveLength(1);

    const publishedRelated = trails.filter((entry) =>
      withRelated!.relatedTrails.includes(entry.slug),
    );
    for (const related of publishedRelated) {
      const link = section.find(`a[href="/style/${related.slug}"]`);
      expect(link, `related trail ${related.slug}`).toHaveLength(1);
      expect(link.text()).toContain(related.title);
    }
    section.find("a").each((_, element) => {
      const text = $(element).text().trim();
      expect(withRelated!.relatedTrails).not.toContain(text);
    });
  });

  // DEV-1967: trails are authored in zh-TW only. /en keeps the links, marks
  // the content's language, and says so in one line.
  test("English trail page marks the Chinese content and says so", async ({
    request,
  }) => {
    const response = await request.get(`/en${TRAIL_URL}`);
    test.skip(response.status() === 503, "PREVIEW_MODE active");

    expect(response.status()).toBe(200);
    const $ = load(await response.text());

    expect(
      $('[lang="zh-Hant-TW"] h1, h1[lang="zh-Hant-TW"]').length,
    ).toBeGreaterThanOrEqual(1);
    expect($("main").text()).toContain("This guide is in Traditional Chinese.");
  });

  test("trail page shares its hero as og:image", async ({ request }) => {
    test.skip(!trail!.heroImage, `trail "${trail!.slug}" has no hero image`);

    const response = await request.get(TRAIL_URL);
    test.skip(response.status() === 503, "PREVIEW_MODE active");

    expect(response.status()).toBe(200);
    const $ = load(await response.text());
    const ogImage = $('meta[property="og:image"]').attr("content") ?? "";

    // Absolutised by Next against `metadataBase`, so compare the path suffix.
    expect(ogImage.endsWith(trail!.heroImage!)).toBe(true);
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

    // The product peek is a decorative `ul[aria-hidden="true"]` sibling of the
    // card link, so role queries cannot see it. Scope it to this card's own
    // `li` — a page-wide locator would let another card's peek satisfy it.
    const card = anonPage.getByRole("listitem").filter({ has: trailLink });
    const peekThumbs = card.locator(':scope > ul[aria-hidden="true"] > li');
    await expect(peekThumbs.first()).toBeAttached({
      timeout: BUDGET.RENDERED,
    });
    const peekCount = await peekThumbs.count();
    expect(peekCount).toBeGreaterThanOrEqual(1);
    expect(peekCount).toBeLessThanOrEqual(4);
  });

  test("trail section shows product tiles with notes", async ({ anonPage }) => {
    const response = await anonPage.goto(TRAIL_URL);
    test.skip(response?.status() === 503, "PREVIEW_MODE active");

    const section = trail!.sections[0];
    test.skip(!section, `trail "${trail!.slug}" has no sections`);

    // The section number ("01") is aria-hidden, so the heading's accessible
    // name is the bare section title.
    const sectionHeading = anonPage.getByRole("heading", {
      name: section.title,
      level: 2,
      exact: true,
    });
    const sectionEl = anonPage
      .locator("section")
      .filter({ has: sectionHeading });
    await expect(sectionEl).toBeVisible({ timeout: BUDGET.SERVER_RENDER });

    // A tile is a list item carrying the product name as a level-3 heading
    // (inside the link to the brand page). The editorial note is the first
    // paragraph directly after that link, ahead of the brand name and the
    // longer product description.
    const tiles = sectionEl
      .getByRole("listitem")
      .filter({ has: anonPage.getByRole("heading", { level: 3 }) });
    const count = await tiles.count();
    test.skip(
      count === 0,
      `trail "${trail!.slug}" section "${section.key}" has no product supply on this target`,
    );
    expect(count).toBeGreaterThanOrEqual(3);

    for (let i = 0; i < count; i++) {
      const tile = tiles.nth(i);
      const name = tile.getByRole("heading", { level: 3 });
      await expect(name).toBeVisible({ timeout: BUDGET.RENDERED });
      const nameText = ((await name.textContent()) ?? "").trim();
      expect(nameText.length).toBeGreaterThan(0);

      const note = tile.locator("a:has(h3) + p");
      await expect(note).toBeVisible({ timeout: BUDGET.RENDERED });
      const noteText = ((await note.textContent()) ?? "").trim();
      expect(noteText.length, `tile "${nameText}" note`).toBeGreaterThan(0);
      expect(noteText, `tile "${nameText}" note`).not.toBe(nameText);
    }
  });
});
