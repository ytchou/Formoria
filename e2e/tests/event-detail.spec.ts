import { test, expect } from '../fixtures/auth';
import {
  NO_SEEDED_EVENTS,
  resolveSeededEvent,
  type SeededEvent,
} from '../utils/seeded-events';

// Every test here needs a real published event, and the `events` table ships empty
// (DEV-1282 lands the surface; content lands separately). The gate is a RUNTIME check
// against the running hub, not a filesystem read — see `e2e/utils/seeded-events.ts` for
// why the `content/stories/` pattern would be wrong for a database-backed entity. The
// slug is resolved from the hub rather than hardcoded, so the first event seeded turns
// this suite green with no edit.
let seeded: SeededEvent | null = null;

test.describe('Event detail deep', () => {
  test.beforeEach(async ({ anonPage }) => {
    seeded = await resolveSeededEvent(anonPage);
    test.skip(seeded === null, NO_SEEDED_EVENTS);
  });

  test('event detail emits Event JSON-LD with a raw Taipei calendar startDate', async ({
    anonPage,
  }) => {
    const event = seeded!;
    await anonPage.goto(`/events/${event.slug}`);

    const blocks = await anonPage
      .locator('script[type="application/ld+json"]')
      .allTextContents();
    expect(blocks.length, 'event detail must emit JSON-LD').toBeGreaterThan(0);

    const eventLd = blocks
      .map((block) => safeParse(block))
      .find((parsed) => parsed?.['@type'] === 'Event');

    expect(eventLd, 'no Event JSON-LD block on the event detail page').toBeTruthy();
    expect(eventLd!['@type']).toBe('Event');
    expect(typeof eventLd!.name).toBe('string');
    expect((eventLd!.name as string).length).toBeGreaterThan(0);

    // The load-bearing assertion. Event dates are Taipei CALENDAR dates end to end —
    // a bare `YYYY-MM-DD`, never a timestamp. The moment one is passed through `new
    // Date(...).toISOString()` anywhere in the chain it becomes `2026-08-05T16:00:00Z`
    // and Google reads an event that opens on 8/6 as starting on 8/5. So: no `T`, no
    // `Z`, no `+08:00`, no time component of any kind.
    const startDate = eventLd!.startDate;
    expect(typeof startDate).toBe('string');
    expect(startDate as string).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(startDate as string).not.toContain('T');
    expect(startDate as string).not.toMatch(/[Zz]|[+-]\d{2}:?\d{2}$/);

    // `endDate` is omitted entirely for a single-day event, so its absence is correct;
    // when present it carries the identical shape constraint.
    if (eventLd!.endDate !== undefined) {
      expect(eventLd!.endDate as string).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(eventLd!.endDate as string).not.toContain('T');
    }
  });

  test('area chips filter the brand grid in place, with no navigation', async ({
    anonPage,
  }) => {
    const event = seeded!;
    await anonPage.goto(`/events/${event.slug}`);

    // `<section aria-labelledby>` exposes role=region named by its own <h2>.
    const lineup = anonPage.getByRole('region', { name: '參展品牌' });
    await expect(lineup).toBeVisible({ timeout: 10_000 });

    // `role="group"` named events.areaFilterAria. Absent when the lineup has no areas
    // to filter by — an authoring state, not a regression.
    const areaFilter = lineup.getByRole('group', { name: '依區域篩選品牌' });
    const chips = areaFilter.getByRole('button');
    const chipCount = await chips.count().catch(() => 0);
    // Chips are "全部區域" plus one per distinct area. With fewer than two real areas a
    // filter click cannot be expected to shrink the grid, so there is nothing to assert.
    test.skip(chipCount < 3, 'event lineup has fewer than two areas to filter by');

    // The lineup ships with only its first four rows visible; the rest are in the HTML
    // but `display: none`, so they are out of the accessibility tree and out of
    // `count()`. Expanding first makes the counts below the WHOLE lineup, which is what
    // the `role=status` line reports — otherwise the two disagree by construction.
    // `\d+` in the name is what separates this from the "顯示全部品牌" filter reset.
    const showAll = lineup.getByRole('button', { name: /^顯示全部 \d+ 個品牌$/ });
    if ((await showAll.count()) > 0) {
      await showAll.click();
      await expect(showAll).toBeHidden();
    }

    // BrandCard renders each card as an <article>; scoped to the lineup region so the
    // page's own wrapper <article> and any related-stories cards cannot be counted.
    const cards = lineup.getByRole('article');
    const totalCards = await cards.count();
    expect(totalCards).toBeGreaterThan(0);

    // Survives a client-side re-render, does not survive a document navigation. This is
    // what "the filter is client-side" actually means to a user: no reload, no flash,
    // no scroll reset. A pathname comparison alone would pass on a full reload.
    await anonPage.evaluate(() => {
      (window as unknown as Record<string, unknown>).__eventFilterProbe = 'alive';
    });
    const pathnameBefore = new URL(anonPage.url()).pathname;

    // First chip after "全部區域" — a concrete area.
    const areaChip = chips.nth(1);
    const areaLabel = (await areaChip.innerText()).trim();
    await expect(areaChip).toHaveAttribute('aria-pressed', 'false');
    await areaChip.click();

    // Pressed state is announced, not signalled by fill colour alone.
    await expect(areaChip).toHaveAttribute('aria-pressed', 'true');
    await expect(chips.first()).toHaveAttribute('aria-pressed', 'false');

    await expect
      .poll(async () => cards.count(), {
        message: `filtering by "${areaLabel}" did not shrink the brand grid`,
        timeout: 10_000,
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
    await expect(lineup.getByRole('status')).toHaveText(
      new RegExp(`\\b${filteredCount}\\b[\\s\\S]*\\b${totalCards}\\b`)
    );

    // No navigation: same document, same pathname.
    expect(
      await anonPage.evaluate(
        () => (window as unknown as Record<string, unknown>).__eventFilterProbe
      )
    ).toBe('alive');
    expect(new URL(anonPage.url()).pathname).toBe(pathnameBefore);

    // "全部區域" restores the full lineup without a navigation either.
    await chips.first().click();
    await expect.poll(async () => cards.count(), { timeout: 10_000 }).toBe(totalCards);
    expect(new URL(anonPage.url()).pathname).toBe(pathnameBefore);
  });

  test('canonical and hreflang are reciprocal across both locales', async ({ anonPage }) => {
    const event = seeded!;
    const slugPattern = escapeRegExp(event.slug);

    await anonPage.goto(`/events/${event.slug}`);

    // zh-TW is prefix-free: the canonical is the bare `/events/<slug>`, never `/en/...`.
    const canonical = anonPage.locator('link[rel="canonical"]');
    await expect(canonical).toHaveCount(1);
    await expect(canonical).toHaveAttribute(
      'href',
      new RegExp(`^https?://[^/]+/events/${slugPattern}$`)
    );
    await expect(canonical).not.toHaveAttribute('href', /\/en\/events\//);

    // The zh-TW edition always exists, and x-default must point at it — an English
    // reader with no matching alternate lands on the canonical URL, not a dead end.
    await expect(anonPage.locator('link[rel="alternate"][hreflang="zh-TW"]')).toHaveAttribute(
      'href',
      new RegExp(`^https?://[^/]+/events/${slugPattern}$`)
    );
    await expect(
      anonPage.locator('link[rel="alternate"][hreflang="x-default"]')
    ).toHaveAttribute('href', new RegExp(`^https?://[^/]+/events/${slugPattern}$`));

    // Public surface: never noindex.
    await expect(anonPage.locator('meta[name="robots"][content*="noindex" i]')).toHaveCount(0);

    // Whether an English alternate is advertised depends on the event having English
    // copy, so the branch is read off the page rather than assumed. Both branches assert
    // the same rule: hreflang must be reciprocal, and a locale with no distinct content
    // must never self-canonicalize into the index as a duplicate.
    const enAlternate = anonPage.locator('link[rel="alternate"][hreflang="en"]');
    const advertisesEnglish = (await enAlternate.count()) > 0;

    if (advertisesEnglish) {
      await expect(enAlternate).toHaveAttribute(
        'href',
        new RegExp(`^https?://[^/]+/en/events/${slugPattern}$`)
      );
    }

    const response = await anonPage.goto(`/en/events/${event.slug}`);
    expect(response?.status()).toBe(200);
    await expect(anonPage.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 });

    const enCanonical = anonPage.locator('link[rel="canonical"]');
    await expect(enCanonical).toHaveCount(1);

    if (advertisesEnglish) {
      // A real English edition self-canonicalizes and points back at zh-TW.
      await expect(enCanonical).toHaveAttribute(
        'href',
        new RegExp(`^https?://[^/]+/en/events/${slugPattern}$`)
      );
      await expect(
        anonPage.locator('link[rel="alternate"][hreflang="zh-TW"]')
      ).toHaveAttribute('href', new RegExp(`^https?://[^/]+/events/${slugPattern}$`));
    } else {
      // No English edition: `/en/events/<slug>` serves byte-identical zh-TW copy, so it
      // must fold into the prefix-free URL rather than enter the index beside it.
      await expect(enCanonical).toHaveAttribute(
        'href',
        new RegExp(`^https?://[^/]+/events/${slugPattern}$`)
      );
      await expect(enCanonical).not.toHaveAttribute('href', /\/en\/events\//);
      await expect(anonPage.locator('link[rel="alternate"][hreflang="en"]')).toHaveCount(0);
    }
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
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
