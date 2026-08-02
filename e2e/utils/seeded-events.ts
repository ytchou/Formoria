import { expect, type Page } from '@playwright/test';

/**
 * Resolves a real, published event to point the deep specs at.
 *
 * DELIBERATELY A RUNTIME CHECK, not a filesystem one. `e2e/utils/published-stories.ts`
 * reads `content/stories/` because a story IS a file in the repo — the directory is
 * the source of truth the service itself reads. Events are not: they live in the
 * `events` table, and `content/events/*.json` only records what *should* be seeded.
 * A filesystem gate here would go green on a JSON file that was never imported, and
 * every spec below it would then fail on a 404 instead of skipping. So the gate asks
 * the running app: load the hub, and if it is showing its empty state, there is
 * nothing to test yet.
 *
 * The hub ships with zero events on purpose (DEV-1282 lands the code; content lands
 * separately), so today this returns `null` and the deep specs skip. The first event
 * seeded into the database un-skips them with no spec edit.
 */
export type SeededEvent = {
  /** Slug segment `/events/[slug]` resolves against. */
  slug: string;
  /** Visible card title on the hub — the event's localized name. */
  name: string;
};

/** Reason string shared by every content-gated skip, so reports read consistently. */
export const NO_SEEDED_EVENTS = 'no published events seeded (events hub is showing its empty state)';

/**
 * `events.comingSoon` in both locales. Matched as an alternation rather than pinned
 * to zh-TW: the prefix-free hub is zh-TW today, but a locale cookie or an
 * Accept-Language default flipping the request to `/en` must still read as "empty",
 * not as "content exists" — the latter would turn a clean skip into a 404 failure.
 */
const COMING_SOON =
  /首波展會資訊正在整理中，敬請期待。|The first events are on their way\./;

/**
 * Worker-scoped memo. The gate costs one page load; without this every test in the
 * describe block pays it again in `beforeEach`. `undefined` means "not yet asked",
 * `null` means "asked, nothing seeded" — the two must stay distinguishable.
 */
let cached: SeededEvent | null | undefined;

export async function resolveSeededEvent(page: Page): Promise<SeededEvent | null> {
  if (cached !== undefined) return cached;

  await page.goto('/events');
  // The hub is a permanent surface: it renders its heading whether or not any event
  // exists. If even this is missing, the hub itself is broken and the deep specs
  // should not quietly skip on the back of it.
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });

  const isEmpty = await page
    .getByText(COMING_SOON)
    .first()
    .isVisible({ timeout: 5_000 })
    .catch(() => false);

  if (isEmpty) {
    cached = null;
    return cached;
  }

  // Not the empty state, so the hub must be listing cards. Both sections (即將登場 /
  // 展會回顧) render `EventCard`, which links to `/events/<slug>`; a section with zero
  // members renders nothing, so whichever section exists supplies the first card.
  const firstCard = page.locator('main a[href*="/events/"]').first();
  await expect(firstCard).toBeVisible({ timeout: 10_000 });

  const href = (await firstCard.getAttribute('href')) ?? '';
  const slug = href.split('/events/')[1]?.split(/[?#]/)[0] ?? '';
  const name = ((await firstCard.innerText()) ?? '').trim();

  if (!slug) {
    // Content exists but the hub is not linking to it — a real regression, and
    // silently skipping would hide it.
    throw new Error(`events hub rendered a card with an unusable href: "${href}"`);
  }

  cached = { slug, name };
  return cached;
}
