import type { Page } from "@playwright/test";

import { BUDGET } from "../budgets";
import { test, expect } from "../fixtures/auth";
import { resolveLinkedExhibitor } from "../utils/expo-explorer";
import {
  NO_SEEDED_EVENTS,
  resolveSeededEvent,
  type SeededEvent,
} from "../utils/seeded-events";

// Every test here needs a real published event, and the `events` table ships empty
// (DEV-1282 lands the surface; content lands separately). The gate is a RUNTIME check
// against the running hub, not a filesystem read — see `e2e/utils/seeded-events.ts` for
// why the `content/stories/` pattern would be wrong for a database-backed entity. The
// slug is resolved from the hub rather than hardcoded, so the first event seeded turns
// this suite green with no edit.
let seeded: SeededEvent | null = null;

test.describe("Event detail deep", () => {
  test.beforeEach(async ({ anonPage }) => {
    seeded = await resolveSeededEvent(anonPage);
    test.skip(seeded === null, NO_SEEDED_EVENTS);
  });

  test("event detail emits Event JSON-LD with a raw Taipei calendar startDate", async ({
    anonPage,
  }) => {
    const event = seeded!;
    await anonPage.goto(`/events/${event.slug}`);

    const blocks = await anonPage
      .locator('script[type="application/ld+json"]')
      .allTextContents();
    expect(blocks.length, "event detail must emit JSON-LD").toBeGreaterThan(0);

    const eventLd = blocks
      .map((block) => safeParse(block))
      .find((parsed) => parsed?.["@type"] === "Event");

    expect(
      eventLd,
      "no Event JSON-LD block on the event detail page",
    ).toBeTruthy();
    expect(eventLd!["@type"]).toBe("Event");
    expect(typeof eventLd!.name).toBe("string");
    expect((eventLd!.name as string).length).toBeGreaterThan(0);

    // The load-bearing assertion. Event dates are Taipei CALENDAR dates end to end —
    // a bare `YYYY-MM-DD`, never a timestamp. The moment one is passed through `new
    // Date(...).toISOString()` anywhere in the chain it becomes `2026-08-05T16:00:00Z`
    // and Google reads an event that opens on 8/6 as starting on 8/5. So: no `T`, no
    // `Z`, no `+08:00`, no time component of any kind.
    const startDate = eventLd!.startDate;
    expect(typeof startDate).toBe("string");
    expect(startDate as string).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(startDate as string).not.toContain("T");
    expect(startDate as string).not.toMatch(/[Zz]|[+-]\d{2}:?\d{2}$/);

    // `endDate` is omitted entirely for a single-day event, so its absence is correct;
    // when present it carries the identical shape constraint.
    if (eventLd!.endDate !== undefined) {
      expect(eventLd!.endDate as string).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(eventLd!.endDate as string).not.toContain("T");
    }
  });

  test("area chips filter the brand grid in place, with no navigation", async ({
    anonPage,
  }) => {
    const event = seeded!;
    await anonPage.goto(`/events/${event.slug}`);

    // `<section aria-labelledby>` exposes role=region named by its own <h2>.
    const lineup = anonPage.getByRole("region", {
      name: "參展品牌",
      exact: true,
    });
    await expect(lineup).toBeVisible({ timeout: BUDGET.INTERACTIVE });

    // `role="group"` named events.areaFilterAria. Absent when the lineup has no areas
    // to filter by — an authoring state, not a regression.
    const areaFilter = lineup.getByRole("group", { name: "依區域篩選品牌" });
    const chips = areaFilter.getByRole("button");
    const chipCount = await chips.count().catch(() => 0);
    // Chips are "全部區域" plus one per distinct area. With fewer than two real areas a
    // filter click cannot be expected to shrink the grid, so there is nothing to assert.
    test.skip(
      chipCount < 3,
      "event lineup has fewer than two areas to filter by",
    );

    // The lineup ships with only its first four rows visible; the rest are in the HTML
    // but `display: none`, so they are out of the accessibility tree and out of
    // `count()`. Expanding first makes the counts below the WHOLE lineup, which is what
    // the `role=status` line reports — otherwise the two disagree by construction.
    // `\d+` in the name is what separates this from the "顯示全部品牌" filter reset.
    const showAll = lineup.getByRole("button", {
      name: /^顯示其餘 \d+ 個品牌$/,
    });
    if ((await showAll.count()) > 0) {
      await showAll.click();
      await expect(showAll).toBeHidden();
    }

    // BrandCard renders each card as an <article>; scoped to the lineup region so the
    // page's own wrapper <article> and any related-stories cards cannot be counted.
    const cards = lineup.getByRole("article");
    const totalCards = await cards.count();
    expect(totalCards).toBeGreaterThan(0);

    // Survives a client-side re-render, does not survive a document navigation. This is
    // what "the filter is client-side" actually means to a user: no reload, no flash,
    // no scroll reset. A pathname comparison alone would pass on a full reload.
    await anonPage.evaluate(() => {
      (window as unknown as Record<string, unknown>).__eventFilterProbe =
        "alive";
    });
    const pathnameBefore = new URL(anonPage.url()).pathname;

    // First chip after "全部區域" — a concrete area.
    const areaChip = chips.nth(1);
    const areaLabel = (await areaChip.innerText()).trim();
    await expect(areaChip).toHaveAttribute("aria-pressed", "false");
    await areaChip.click();

    // Pressed state is announced, not signalled by fill colour alone.
    await expect(areaChip).toHaveAttribute("aria-pressed", "true");
    await expect(chips.first()).toHaveAttribute("aria-pressed", "false");

    await expect
      .poll(async () => cards.count(), {
        message: `filtering by "${areaLabel}" did not shrink the brand grid`,
        timeout: BUDGET.INTERACTIVE,
      })
      .toBeLessThan(totalCards);

    const filteredCount = await cards.count();
    expect(filteredCount).toBeGreaterThan(0);

    // events.brandCountFiltered live region. Scoped to the lineup region so Next's
    // route announcer — which is also role=status/alert, at document level — cannot
    // match.
    //
    // Both numbers, in order: a bare `toContainText(filteredCount)` also passed when
    // the line rendered the TOTAL, because a single digit matches inside the other
    // number ("3" is in "38"). The filtered line has to say what it filtered from.
    await expect(lineup.getByRole("status")).toHaveText(
      new RegExp(`\\b${filteredCount}\\b[\\s\\S]*\\b${totalCards}\\b`),
    );

    // No navigation: same document, same pathname.
    expect(
      await anonPage.evaluate(
        () => (window as unknown as Record<string, unknown>).__eventFilterProbe,
      ),
    ).toBe("alive");
    expect(new URL(anonPage.url()).pathname).toBe(pathnameBefore);

    // "全部區域" restores the full lineup without a navigation either.
    await chips.first().click();
    await expect
      .poll(async () => cards.count(), { timeout: BUDGET.INTERACTIVE })
      .toBe(totalCards);
    expect(new URL(anonPage.url()).pathname).toBe(pathnameBefore);
  });

  test("canonical and hreflang are reciprocal across both locales", async ({
    anonPage,
  }) => {
    const event = seeded!;
    const slugPattern = escapeRegExp(event.slug);

    await anonPage.goto(`/events/${event.slug}`);

    // zh-TW is prefix-free: the canonical is the bare `/events/<slug>`, never `/en/...`.
    const canonical = anonPage.locator('link[rel="canonical"]');
    await expect(canonical).toHaveCount(1);
    await expect(canonical).toHaveAttribute(
      "href",
      new RegExp(`^https?://[^/]+/events/${slugPattern}$`),
    );
    await expect(canonical).not.toHaveAttribute("href", /\/en\/events\//);

    // The zh-TW edition always exists, and x-default must point at it — an English
    // reader with no matching alternate lands on the canonical URL, not a dead end.
    await expect(
      anonPage.locator('link[rel="alternate"][hreflang="zh-TW"]'),
    ).toHaveAttribute(
      "href",
      new RegExp(`^https?://[^/]+/events/${slugPattern}$`),
    );
    await expect(
      anonPage.locator('link[rel="alternate"][hreflang="x-default"]'),
    ).toHaveAttribute(
      "href",
      new RegExp(`^https?://[^/]+/events/${slugPattern}$`),
    );

    // Public surface: never noindex.
    await expect(
      anonPage.locator('meta[name="robots"][content*="noindex" i]'),
    ).toHaveCount(0);

    // Whether an English alternate is advertised depends on the event having English
    // copy, so the branch is read off the page rather than assumed. Both branches assert
    // the same rule: hreflang must be reciprocal, and a locale with no distinct content
    // must never self-canonicalize into the index as a duplicate.
    const enAlternate = anonPage.locator(
      'link[rel="alternate"][hreflang="en"]',
    );
    const advertisesEnglish = (await enAlternate.count()) > 0;

    if (advertisesEnglish) {
      await expect(enAlternate).toHaveAttribute(
        "href",
        new RegExp(`^https?://[^/]+/en/events/${slugPattern}$`),
      );
    }

    const response = await anonPage.goto(`/en/events/${event.slug}`);
    expect(response?.status()).toBe(200);
    await expect(anonPage.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: BUDGET.INTERACTIVE,
    });

    const enCanonical = anonPage.locator('link[rel="canonical"]');
    await expect(enCanonical).toHaveCount(1);

    if (advertisesEnglish) {
      // A real English edition self-canonicalizes and points back at zh-TW.
      await expect(enCanonical).toHaveAttribute(
        "href",
        new RegExp(`^https?://[^/]+/en/events/${slugPattern}$`),
      );
      await expect(
        anonPage.locator('link[rel="alternate"][hreflang="zh-TW"]'),
      ).toHaveAttribute(
        "href",
        new RegExp(`^https?://[^/]+/events/${slugPattern}$`),
      );
    } else {
      // No English edition: `/en/events/<slug>` serves byte-identical zh-TW copy, so it
      // must fold into the prefix-free URL rather than enter the index beside it.
      await expect(enCanonical).toHaveAttribute(
        "href",
        new RegExp(`^https?://[^/]+/events/${slugPattern}$`),
      );
      await expect(enCanonical).not.toHaveAttribute("href", /\/en\/events\//);
      await expect(
        anonPage.locator('link[rel="alternate"][hreflang="en"]'),
      ).toHaveCount(0);
    }
  });
});

const CREATIVE_EXPO_SLUG = "2026-taiwan-creative-expo";

/**
 * One test used to assert roughly twenty things across the DOM window, the zone
 * chips, three searches, pagination, and a brand navigation. Any one failure took
 * the other nineteen assertions with it and reported under a name that described
 * none of them, so the split below is by contract, not by convenience:
 *
 *   1. the crawler window — every row in the DOM, with a non-empty visible slice
 *   2. zone chips and the `?zone=` round trip
 *   3. search, and the journey from a booth number to a brand page
 *   4. pagination, including the reset-to-page-1 rule
 *
 * The explorer is specific to this event, but its rows are mutable content. Every
 * expected count and search subject below is derived from the rendered journey so
 * roster maintenance cannot turn a valid data update into a CI failure (DEV-1443).
 */
test.describe("Creative Expo exhibitor list", () => {
  const explorerOf = (page: Page) =>
    page.getByRole("region", { name: "All exhibitors" });

  test("@smoke every exhibitor is in the DOM and the visible window is bounded by the total", async ({
    anonPage,
  }) => {
    const response = await anonPage.goto(`/en/events/${CREATIVE_EXPO_SLUG}`);
    if (response?.status() === 503) {
      test.skip(
        true,
        "PREVIEW_MODE blocks the public event route in this environment.",
      );
    }
    expect(response?.status()).toBe(200);

    const explorer = explorerOf(anonPage);
    const total = statusCount(await explorer.getByRole("status").innerText());

    // The load-bearing property of this list: every exhibitor is in the DOM.
    // A data slice here would hide rows from crawlers, which is the whole reason
    // pagination uses CSS visibility instead.
    await expect(explorer.locator("li")).toHaveCount(total);

    // A small roster validly fits on one page and an empty roster validly has no
    // visible rows. The contract is that the window never invents rows that are
    // absent from the status total.
    const visible = await explorer.locator("li:visible").count();
    expect(visible).toBeLessThanOrEqual(total);
  });

  test("zone chips filter the roster and round-trip through ?zone=", async ({
    anonPage,
  }) => {
    await anonPage.goto(`/en/events/${CREATIVE_EXPO_SLUG}`);
    const explorer = explorerOf(anonPage);
    const status = explorer.getByRole("status");
    const total = statusCount(await status.innerText());

    // Only the explorer's current zone codes get a chip, so both the subject and
    // its count come from the rendered control rather than a second data source.
    // The zone code leads the accessible name — it is what ties the chip to the
    // `K2-###` booth numbers on the floor plan and in every row.
    const zoneGroup = explorer.getByRole("group", {
      name: "Filter exhibitors by zone",
    });
    const zoneChip = zoneGroup
      .getByRole("button")
      .filter({ hasNotText: /^All zones/ })
      .first();
    test.skip(
      (await zoneChip.count()) === 0,
      "Creative Expo currently has no zone filters",
    );
    const chipLabel = await zoneChip.innerText();
    const zoneCode = chipLabel.trim().split(/\s+/).at(0);
    expect(zoneCode, `Zone chip has no code: "${chipLabel}"`).toBeTruthy();
    const chipCount = trailingCount(chipLabel);
    expect(chipCount).toBeGreaterThan(0);

    await zoneChip.click();
    await expect(zoneChip).toHaveAttribute("aria-pressed", "true");
    // The `?zone=` round trip is the one URL contract that survived the map's
    // retirement; shared zone links must keep working.
    await expect(anonPage).toHaveURL(new RegExp(`\\?zone=${zoneCode}$`));
    await expect(status).toHaveText(`${chipCount} of ${total} exhibitors`);
    await expect(explorer.locator("li")).toHaveCount(chipCount);

    // "All zones" is the only zone reset now — the redundant button beside the
    // count line is gone, so this chip carries the `?zone=` clearing contract.
    await explorer.getByRole("button", { name: "All zones" }).click();
    await expect(status).toHaveText(`${total} exhibitors`);
    await expect(anonPage).toHaveURL(`/en/events/${CREATIVE_EXPO_SLUG}`);

    // A shared `?zone=` link must land pre-filtered, not merely unfiltered.
    await anonPage.goto(`/en/events/${CREATIVE_EXPO_SLUG}?zone=${zoneCode}`);
    await expect(zoneChip).toHaveAttribute("aria-pressed", "true");
    await expect(status).toHaveText(`${chipCount} of ${total} exhibitors`);
  });

  test("search narrows the roster and the brand name opens the brand page", async ({
    anonPage,
  }) => {
    await anonPage.goto(`/en/events/${CREATIVE_EXPO_SLUG}`);
    const explorer = explorerOf(anonPage);
    const status = explorer.getByRole("status");
    const total = statusCount(await status.innerText());
    const resolvedSubject = await resolveLinkedExhibitor(explorer, "en");
    test.skip(
      resolvedSubject === null,
      "Creative Expo currently has no linked exhibitors",
    );
    const subject = resolvedSubject!;
    const search = explorer.getByRole("searchbox", {
      name: "Search exhibitor names, romanization, or booth number",
    });

    await search.fill("__e2e_no_such_exhibitor__");
    await expect(status).toHaveText(`0 of ${total} exhibitors`);
    await expect(subject.link).toBeHidden();

    // Booth and visible brand name are independent search paths to the same row.
    await search.fill(subject.booth);
    await expect(status).toHaveText(new RegExp(`\\d+ of ${total} exhibitors`));
    await expect(subject.link).toBeVisible();
    await expect(subject.row).toContainText(subject.booth);

    // The row names the brand rather than echoing its slug — the same
    // bare-slug-stub regression story-detail guards for BrandCard.
    expect(subject.name).not.toBe(subject.href.split("/").at(-1));
    await search.fill(subject.name);
    await expect(subject.link).toBeVisible();

    // Clearing the query is the search field's own job — no button resets it.
    await search.fill("");
    await expect(search).toHaveValue("");
    await expect(status).toHaveText(`${total} exhibitors`);

    // Wait for the filtered list to settle before clicking. Every row stays in
    // the DOM and pagination only toggles `hidden`, so this row is present but
    // display:none until the search narrows the set onto page 1 — clicking
    // straight after `fill` races that re-render.
    await search.fill(subject.booth);
    await expect(subject.link).toBeVisible();
    await subject.link.click();
    // Explicit budget: locally the first navigation to /en/brands/[slug] pays
    // Turbopack's on-demand compile (measured 4.4-8.4s) and would blow the 5s
    // default. global-setup warms that route, but the warm-up is deliberately
    // non-fatal — this keeps a silent warm-up failure from looking like a
    // navigation bug in the product.
    await expect(anonPage).toHaveURL(
      new RegExp(`${escapeRegExp(subject.href)}$`),
      { timeout: BUDGET.GATED_UI },
    );
    await expect(anonPage.getByRole("heading", { level: 1 })).toBeVisible();

    // Back restores the unfiltered list, and the same search still works on it.
    await anonPage.goBack();
    await expect(anonPage).toHaveURL(`/en/events/${CREATIVE_EXPO_SLUG}`);
    await expect(search).toHaveValue("");
    await search.fill(subject.booth);
    await expect(subject.link).toBeVisible();
  });

  test("paging advances the window and any filter change resets to page 1", async ({
    anonPage,
  }) => {
    await anonPage.goto(`/en/events/${CREATIVE_EXPO_SLUG}`);
    const explorer = explorerOf(anonPage);
    const position = explorer.getByText(/^Page \d+ of \d+$/);
    test.skip(
      (await position.count()) === 0,
      "Creative Expo roster currently fits on one page",
    );
    const pageCount = pagePositionCount(await position.innerText());
    test.skip(pageCount < 2, "Creative Expo roster currently fits on one page");
    const windowSize = await explorer.locator("li:visible").count();
    const firstRow = explorer.locator("li").first();
    const firstBooth = (
      await firstRow.locator("span.tabular-nums").innerText()
    ).trim();

    await explorer
      .getByRole("navigation", { name: "Exhibitor list pagination" })
      .getByRole("button", { name: "Go to next page" })
      .click();
    await expect(position).toHaveText(`Page 2 of ${pageCount}`);
    await expect(anonPage).toHaveURL(/\?page=2$/);
    await expect(explorer.locator("li:visible")).toHaveCount(windowSize);

    // A search must force page 1. Searching for a row from the first window
    // would otherwise leave a matching row hidden on page 2.
    await explorer
      .getByRole("searchbox", {
        name: "Search exhibitor names, romanization, or booth number",
      })
      .fill(firstBooth);
    await expect(firstRow).toBeVisible();
    await expect(anonPage).not.toHaveURL(/[?&]page=2(?:&|$)/);
  });

  test("localized source context and server-rendered brand links preserve the event contract", async ({
    anonPage,
  }) => {
    const serverResponse = await anonPage.request.get(
      `/en/events/${CREATIVE_EXPO_SLUG}`,
    );
    expect(serverResponse.status()).toBe(200);
    const serverHtml = await serverResponse.text();

    await anonPage.goto(`/events/${CREATIVE_EXPO_SLUG}`);
    const zhExplorer = anonPage.getByRole("region", {
      name: "參展品牌",
      exact: true,
    });
    await expect(
      zhExplorer.getByRole("heading", { name: "全部參展單位" }),
    ).toBeVisible();
    // Map provenance lives with the venue facts, not in the explorer: the
    // official plan describes the hall and filters nothing.
    const zhAbout = anonPage.getByRole("region", { name: "活動介紹" });
    await expect(
      zhAbout.getByRole("heading", { name: "展場平面圖" }),
    ).toBeVisible();
    await expect(zhAbout).toContainText("平面圖來源：2026 臺灣文博會");
    await expect(
      zhAbout.getByRole("link", { name: "官方平面圖 PDF" }),
    ).toHaveAttribute("href", /creativexpo\.tw\/uploads\/download\/file/);
    // Roster provenance sits with the map's, not at the foot of the explorer.
    // Catches attribution drifting to an arbitrary linked exhibitor detail page.
    await expect(
      zhAbout.getByRole("link", { name: "官方參展名單" }),
    ).toHaveAttribute("href", /^https:\/\/creativexpo\.tw\//);

    await anonPage.goto(`/en/events/${CREATIVE_EXPO_SLUG}`);
    const enLineup = anonPage.getByRole("region", {
      name: "Exhibiting brands",
    });
    await expect(
      enLineup.getByRole("heading", { name: "All exhibitors" }),
    ).toBeVisible();
    await expect(
      anonPage.getByRole("region", { name: "About this event" }),
    ).toContainText("Map source: Taiwan Creative Expo 2026");

    // Pagination hides rows with CSS and never slices them, so every exhibitor
    // — including the ones on the last page and the ones we do not list — has
    // to be in the server HTML. That is the crawler-visibility guarantee the
    // paged window is allowed to trade nothing away for.
    const explorer = anonPage.getByRole("region", { name: "All exhibitors" });
    const brandHrefs = await explorer
      .locator('a[href^="/en/brands/"]')
      .evaluateAll((links) =>
        links.map((link) => link.getAttribute("href") ?? ""),
      );
    expect(
      brandHrefs.filter((href) => !serverHtml.includes(`href="${href}"`)),
    ).toEqual([]);
  });

  test("a failed floor-map image leaves the exhibitor list, search, and navigation usable", async ({
    anonPage,
  }) => {
    // The official raster is rendered twice -- inline in the venue facts and
    // again in the full-screen viewer. A dead image must degrade to the
    // fallback in BOTH surfaces and leave the exhibitor list, its search and
    // brand navigation untouched; that whole guarantee is what this test holds.
    let mapImageFailed = false;
    await anonPage.route("**/_next/image**", async (route) => {
      const source = new URL(route.request().url()).searchParams.get("url");
      if (source?.endsWith("/taiwan-creative-expo-2026-floor-map.webp")) {
        mapImageFailed = true;
        await route.abort("failed");
        return;
      }
      await route.continue();
    });
    await anonPage.goto(`/en/events/${CREATIVE_EXPO_SLUG}`);

    const explorer = anonPage.getByRole("region", { name: "All exhibitors" });
    const resolvedSubject = await resolveLinkedExhibitor(explorer, "en");
    test.skip(
      resolvedSubject === null,
      "Creative Expo currently has no linked exhibitors",
    );
    const subject = resolvedSubject!;

    // The raster and its trigger live with the venue facts, not inside the
    // exhibitor list. It is lazily loaded, so the request only fires once the
    // section is scrolled into view.
    const about = anonPage.getByRole("region", { name: "About this event" });
    await about.scrollIntoViewIfNeeded();
    await expect(
      about.getByText("The map image could not be loaded."),
    ).toBeVisible();
    await expect.poll(() => mapImageFailed).toBe(true);

    await about.getByRole("button", { name: "Full-screen map" }).click();
    const viewer = anonPage.getByRole("dialog");
    await expect(viewer).toBeVisible();

    await expect(
      viewer.getByText("The map image could not be loaded."),
    ).toBeVisible();
    await expect(
      viewer.getByRole("link", { name: "Official map PDF" }).first(),
    ).toHaveAttribute("href", /creativexpo\.tw\/uploads\/download/);

    await viewer
      .getByRole("button", { name: "Close floor-map viewer" })
      .click();
    await expect(viewer).toBeHidden();

    await explorer
      .getByRole("searchbox", {
        name: "Search exhibitor names, romanization, or booth number",
      })
      .fill(subject.booth);
    await expect(subject.link).toBeVisible();
    await subject.link.click();
    await expect(anonPage).toHaveURL(
      new RegExp(`${escapeRegExp(subject.href)}$`),
    );
  });
});

/** JSON-LD blocks are JSON, but a malformed one must fail the assertion, not the run. */
function safeParse(block: string): Record<string, unknown> | null {
  try {
    return JSON.parse(block) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Event slugs come from the database, so escape before building a URL matcher. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function statusCount(value: string): number {
  const match = value.match(/\d+/);
  if (!match) throw new Error(`Result status has no count: "${value}"`);
  return Number(match[0]);
}

function trailingCount(value: string): number {
  const match = value.match(/(\d+)\s*$/);
  if (!match) throw new Error(`Zone control has no count: "${value}"`);
  return Number(match[1]);
}

/** "Page 3 of 16" -> 16. */
function pagePositionCount(value: string): number {
  const match = value.match(/of\s+(\d+)\s*$/);
  if (!match) throw new Error(`Page position has no page count: "${value}"`);
  return Number(match[1]);
}
