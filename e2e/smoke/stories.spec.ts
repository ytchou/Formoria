import { test, expect } from '../fixtures/auth';
import { NO_PUBLISHED_STORIES, publishedStories } from '../utils/published-stories';

// Routing context (DEV-930):
// - `stories` is registered in RESERVED_ROUTES + PUBLIC_INTL_SEGMENTS in proxy.ts, so
//   bare `/stories` is not swallowed by the brand-slug redirect and resolves to the hub
//   under the prefix-free zh-TW locale.
// - Category filter links on the hub use /stories?category=… (no locale prefix) and stay
//   on the hub.
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
    const storiesLink = anonPage.getByRole('link', { name: '專題' });
    await expect(storiesLink).toBeVisible({ timeout: 10_000 });
    await expect(storiesLink).toHaveAttribute('href', '/stories');
  });

  test('clicking 專題 nav link arrives at stories hub', async ({ anonPage }) => {
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

  test('stories hub renders at least one story card once content exists', async ({ anonPage }) => {
    test.skip(stories.length === 0, NO_PUBLISHED_STORIES);
    await anonPage.goto('/zh-TW/stories');
    await expect(anonPage.locator('main a[href*="/stories/"]').first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test('story detail renders in zh-TW and 404s in en', async ({ anonPage }) => {
    test.skip(stories.length === 0, NO_PUBLISHED_STORIES);
    await anonPage.goto(`/zh-TW/stories/${firstStory.slug}`);
    await expect(anonPage.getByRole('heading', { level: 1 })).toBeVisible({
      timeout: 10_000,
    });

    // The story is authored in zh-TW only — the English route must not serve it
    const response = await anonPage.goto(`/en/stories/${firstStory.slug}`);
    expect(response?.status()).toBe(404);
  });

  test('category filter pill updates URL with ?category= and stays on hub', async ({ anonPage }) => {
    await anonPage.goto('/zh-TW/stories');
    // Accessible name is stories.categoriesAria, so it is localized — this route is
    // zh-TW, so matching the English 'Story categories' can never resolve.
    const categoryNav = anonPage.getByRole('navigation', { name: '專題分類' });
    await expect(categoryNav).toBeVisible({ timeout: 10_000 });
    // Scoped to the story categories nav to avoid clicking the brand category bar
    await categoryNav.getByRole('link', { name: '美妝保養' }).click();
    await expect(anonPage).toHaveURL(/[?&]category=beauty/, { timeout: 10_000 });
    // Must remain on stories hub — not redirected to /brands
    await expect(
      anonPage.getByRole('heading', { name: '專題', level: 1 })
    ).toBeVisible({ timeout: 5_000 });
  });

  test('All pill clears category filter and stays on hub', async ({ anonPage }) => {
    await anonPage.goto('/zh-TW/stories?category=beauty');
    const categoryNav = anonPage.getByRole('navigation', { name: '專題分類' });
    await expect(categoryNav).toBeVisible({ timeout: 10_000 });
    // stories.allCategories, localized: '全部' on zh-TW, 'All' on en
    await categoryNav.getByRole('link', { name: '全部' }).click();
    await expect(anonPage).not.toHaveURL(/[?&]category=/, { timeout: 10_000 });
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
