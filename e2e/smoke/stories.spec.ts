import { test, expect } from '../fixtures/auth';
import { NO_PUBLISHED_STORIES, publishedStories } from '../utils/published-stories';

// Routing context (DEV-930):
// - `stories` is registered in RESERVED_ROUTES + PUBLIC_INTL_SEGMENTS in proxy.ts, so
//   bare `/stories` is not swallowed by the brand-slug redirect and resolves to the hub
//   under the prefix-free zh-TW locale.
// - Tag filter links on the hub use /stories?tag=… (no locale prefix) and stay on the hub.
// - The story card href is /stories/<slug> (2-segment path, no brand-slug redirect).
//
// Content gating: editorial content lives in `content/stories/`, which ships empty. The
// hub itself must render regardless (heading + coming-soon empty state), so those checks
// run unconditionally. Anything that needs a real story is gated on content presence and
// un-skips itself the moment the first story is merged.
const stories = publishedStories('zh-TW');
const firstStory = stories[0];

test.describe('Stories hub smoke', () => {
  test('nav has visible 專題 link pointing to /stories', async ({ anonPage }) => {
    await anonPage.goto('/');
    // 專題 now appears twice on every page — the header nav gained a /stories entry
    // alongside the footer's. `.first()` is the header one in DOM order; without it
    // this is a strict-mode violation, not a selector problem.
    const storiesLink = anonPage.getByRole('link', { name: '專題' }).first();
    await expect(storiesLink).toBeVisible({ timeout: 10_000 });
    await expect(storiesLink).toHaveAttribute('href', '/stories');
  });

  test('clicking 專題 nav link arrives at stories hub', async ({ anonPage }) => {
    await anonPage.goto('/');
    await anonPage.getByRole('link', { name: '專題' }).first().click();
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

  test('stories hub renders at least one story card once content exists', async ({ anonPage }) => {
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

  test('tag filter pill updates URL with ?tag= and stays on hub', async ({ anonPage }) => {
    await anonPage.goto('/zh-TW/stories');
    // Accessible name is stories.tagsAria, so it is localized — this route is
    // zh-TW, so matching the English 'Story tags' can never resolve.
    const tagNav = anonPage.getByRole('navigation', { name: '專題標籤' });
    await expect(tagNav).toBeVisible({ timeout: 10_000 });
    // Scoped to the story tags nav to avoid clicking the brand category bar
    await tagNav.getByRole('link', { name: '美妝保養' }).click();
    await expect(anonPage).toHaveURL(/[?&]tag=beauty/, { timeout: 10_000 });
    // Must remain on stories hub — not redirected to /brands
    await expect(
      anonPage.getByRole('heading', { name: '專題', level: 1 })
    ).toBeVisible({ timeout: 5_000 });
  });

  test('All pill clears the tag filter and stays on hub', async ({ anonPage }) => {
    await anonPage.goto('/zh-TW/stories?tag=beauty');
    const tagNav = anonPage.getByRole('navigation', { name: '專題標籤' });
    await expect(tagNav).toBeVisible({ timeout: 10_000 });
    // stories.allTags, localized: '全部' on zh-TW, 'All' on en
    await tagNav.getByRole('link', { name: '全部' }).click();
    await expect(anonPage).not.toHaveURL(/[?&]tag=/, { timeout: 10_000 });
    await expect(
      anonPage.getByRole('heading', { name: '專題', level: 1 })
    ).toBeVisible({ timeout: 5_000 });
  });

  test('story card click navigates to /stories/[slug] detail page', async ({ anonPage }) => {
    test.skip(stories.length === 0, NO_PUBLISHED_STORIES);
    await anonPage.goto('/zh-TW/stories');
    const firstCard = anonPage.locator('main a[href*="/stories/"]').first();
    await expect(firstCard).toBeVisible({ timeout: 10_000 });
    await firstCard.click();
    await expect(anonPage).toHaveURL(/\/stories\/[a-z][a-z0-9-]+/, { timeout: 15_000 });
    // Must not be a 404 — story detail should render its own h1
    await expect(anonPage).not.toHaveTitle(/^404/);
    await expect(anonPage.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 });
  });
});
