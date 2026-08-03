import { test, expect } from '../fixtures/auth';
import { NO_PUBLISHED_STORIES, publishedStories } from '../utils/published-stories';

// Routing context (DEV-930):
// - `stories` is registered in RESERVED_ROUTES + PUBLIC_INTL_SEGMENTS in proxy.ts, so
//   bare `/stories` is not swallowed by the brand-slug redirect and resolves to the hub
//   under the prefix-free zh-TW locale.
// - Tag filter links on the hub use /stories?tag=… (no locale prefix) and stay on the hub.
// - The story row href is /stories/<slug> (2-segment path, no brand-slug redirect).
//
// Content gating: editorial content lives in `content/stories/`, which ships empty. The
// hub itself must render regardless (heading + coming-soon empty state), so those checks
// run unconditionally. Anything that needs a real story is gated on content presence and
// un-skips itself the moment the first story is merged.
const stories = publishedStories('zh-TW');
const firstStory = stories[0];

test.describe('Stories hub smoke', () => {
  // The header nav's /stories entry was pulled back out, so the footer link is the
  // single site-wide 專題 entry point again — no `.first()` disambiguation needed.
  test('footer has visible 專題 link pointing to /stories', async ({ anonPage }) => {
    await anonPage.goto('/');
    const storiesLink = anonPage.getByRole('link', { name: '專題' });
    await expect(storiesLink).toBeVisible({ timeout: 10_000 });
    await expect(storiesLink).toHaveAttribute('href', '/stories');
  });

  test('clicking 專題 footer link arrives at stories hub', async ({ anonPage }) => {
    await anonPage.goto('/');
    await anonPage.getByRole('link', { name: '專題' }).click();
    // Default zh-TW locale — must land at /stories (no prefix)
    await expect(anonPage).toHaveURL(/\/stories(?:[?#]|$)/, { timeout: 15_000 });
    await expect(
      anonPage.getByRole('heading', { name: '專題', level: 1 })
    ).toBeVisible({ timeout: 10_000 });
  });

  test('stories hub returns 200 and renders its heading with no content published', async ({
    anonPage,
  }) => {
    const response = await anonPage.goto('/zh-TW/stories');
    expect(response?.status()).toBe(200);
    await expect(
      anonPage.getByRole('heading', { name: '專題', level: 1 })
    ).toBeVisible({ timeout: 10_000 });

    if (stories.length === 0) {
      // stories.comingSoon — the empty hub must say so, not render a bare page.
      await expect(anonPage.getByText('敬請期待')).toBeVisible({ timeout: 10_000 });
      await expect(anonPage.locator('main a[href*="/stories/"]')).toHaveCount(0);
    }
  });

  test('stories hub renders at least one story row once content exists', async ({ anonPage }) => {
    test.skip(stories.length === 0, NO_PUBLISHED_STORIES);
    await anonPage.goto('/zh-TW/stories');
    await expect(anonPage.locator('main a[href*="/stories/"]').first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test('story detail renders in zh-TW and is also served on en', async ({ anonPage }) => {
    test.skip(stories.length === 0, NO_PUBLISHED_STORIES);
    await anonPage.goto(`/zh-TW/stories/${firstStory.slug}`);
    await expect(anonPage.getByRole('heading', { level: 1 })).toBeVisible({
      timeout: 10_000,
    });

    // Inverted from a 404 expectation: English editions do not exist yet, so the
    // English route serves the same zh-TW document instead of a dead end. It must
    // canonical back to the prefix-free zh-TW URL — asserted in detail in
    // e2e/tests/story-detail.spec.ts.
    const response = await anonPage.goto(`/en/stories/${firstStory.slug}`);
    expect(response?.status()).toBe(200);
  });

  // The tag-pill nav was removed from the hub; `?tag=` filtering itself still runs
  // server-side, so the routing regression these tests guard (a ?tag= URL must not
  // be swallowed by the brand-slug redirect) is asserted by URL instead of by click.
  test('?tag= URL renders the hub and is not redirected away', async ({ anonPage }) => {
    await anonPage.goto('/zh-TW/stories?tag=beauty');
    await expect(anonPage).toHaveURL(/[?&]tag=beauty/, { timeout: 10_000 });
    await expect(
      anonPage.getByRole('heading', { name: '專題', level: 1 })
    ).toBeVisible({ timeout: 10_000 });
  });

  test('hub no longer renders a tag filter nav', async ({ anonPage }) => {
    await anonPage.goto('/zh-TW/stories');
    await expect(
      anonPage.getByRole('heading', { name: '專題', level: 1 })
    ).toBeVisible({ timeout: 10_000 });
    // Accessible name is stories.tagsAria, localized to 專題標籤 on zh-TW.
    await expect(anonPage.getByRole('navigation', { name: '專題標籤' })).toHaveCount(0);
  });

  test('story row click navigates to /stories/[slug] detail page', async ({ anonPage }) => {
    test.skip(stories.length === 0, NO_PUBLISHED_STORIES);
    await anonPage.goto('/zh-TW/stories');
    const firstRow = anonPage.locator('main a[href*="/stories/"]').first();
    await expect(firstRow).toBeVisible({ timeout: 10_000 });
    await firstRow.click();
    // A slug may start with a digit — year-prefixed slugs like
    // `2026-taiwan-creative-expo-category-guide` are ordinary, and the newest
    // story is the one this test clicks, so a letter-first class breaks the
    // moment such a story is published.
    await expect(anonPage).toHaveURL(/\/stories\/[a-z0-9][a-z0-9-]+/, { timeout: 15_000 });
    // Must not be a 404 — story detail should render its own h1
    await expect(anonPage).not.toHaveTitle(/^404/);
    await expect(anonPage.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 });
  });
});
