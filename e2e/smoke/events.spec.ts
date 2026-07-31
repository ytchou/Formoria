import { test, expect } from '../fixtures/auth';

// Routing context (DEV-1282, mirrors the /stories treatment in DEV-930):
// - zh-TW is the prefix-free default locale, so the hub is `/events` with no prefix and
//   English lives at `/en/events`.
// - The header and footer entries both point at the bare `/events`, so 展會 resolves twice
//   on every page — the same strict-mode hazard 專題 has in `e2e/smoke/stories.spec.ts`.
//
// Content gating: the `events` table ships empty (this PR lands the surface; event content
// lands separately). The hub itself must render regardless — heading plus empty state — so
// those checks run unconditionally, and the one card assertion below flips from "empty
// state" to "real cards" on its own the moment the first event is seeded.
const COMING_SOON = '首波展會資訊正在整理中，敬請期待。';

test.describe('Events hub smoke', () => {
  test('nav has visible 展會 link pointing to /events', async ({ anonPage }) => {
    await anonPage.goto('/');
    // 展會 appears twice on every page — header nav and footer. `.first()` is the header
    // one in DOM order; without it this is a strict-mode violation, not a selector problem.
    // Deliberately no assertion on how many nav links exist: a count is drift bait.
    const eventsLink = anonPage.getByRole('link', { name: '展會' }).first();
    await expect(eventsLink).toBeVisible({ timeout: 10_000 });
    await expect(eventsLink).toHaveAttribute('href', '/events');
  });

  test('clicking 展會 nav link arrives at events hub', async ({ anonPage }) => {
    await anonPage.goto('/');
    // Must be a real click, never a `page.goto`. The nav entries are bare `<a>` rather
    // than next-intl `<Link>` precisely because the client-side RSC request stalls across
    // the locale proxy rewrite (DEV-1280); a `goto` issues a fresh document request and
    // would sail past that bug. This click is the assertion that catches it.
    await anonPage.getByRole('link', { name: '展會' }).first().click();
    // Default zh-TW locale — must land at /events (no prefix).
    await expect(anonPage).toHaveURL(/\/events(?:[?#]|$)/, { timeout: 15_000 });
    await expect(
      anonPage.getByRole('heading', { name: '展會', level: 1 })
    ).toBeVisible({ timeout: 10_000 });
  });

  test('events hub returns 200 and renders its heading with no events seeded', async ({
    anonPage,
  }) => {
    const response = await anonPage.goto('/events');
    // Zero published events is a 200 with an empty state, not a 404: the hub is a
    // permanent, linkable surface whose content simply has not landed yet.
    expect(response?.status()).toBe(200);
    await expect(
      anonPage.getByRole('heading', { name: '展會', level: 1 })
    ).toBeVisible({ timeout: 10_000 });

    const cards = anonPage.locator('main a[href*="/events/"]');
    if ((await cards.count()) === 0) {
      // events.comingSoon — the empty hub must say so, not render a bare page.
      await expect(anonPage.getByText(COMING_SOON)).toBeVisible({ timeout: 10_000 });
    } else {
      // Content has landed: the empty state must be gone and cards must be linkable.
      await expect(anonPage.getByText(COMING_SOON)).toHaveCount(0);
      await expect(cards.first()).toBeVisible({ timeout: 10_000 });
    }
  });
});
