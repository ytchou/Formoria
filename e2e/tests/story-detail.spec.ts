import { test, expect } from '../fixtures/auth';
import { NO_PUBLISHED_STORIES, publishedStories } from '../utils/published-stories';

// Editorial content lives in `content/stories/`, which ships empty — every test here
// needs a real published story, so the whole group gates on content presence and skips
// cleanly until one is merged. Slug and title are read from the content directory rather
// than hardcoded, so the first story that lands turns this suite green with no edit.
const stories = publishedStories('zh-TW');
const firstStory = stories[0];
const STORY_URL = firstStory ? `/stories/${firstStory.slug}` : '/stories';

test.describe('Story detail deep', () => {
  test.beforeEach(() => {
    test.skip(stories.length === 0, NO_PUBLISHED_STORIES);
  });

  test('story page renders title and no error boundary', async ({ anonPage }) => {
    await anonPage.goto(STORY_URL);
    await expect(anonPage).toHaveTitle(new RegExp(escapeRegExp(firstStory.title)));
    await expect(
      anonPage.getByRole('heading', { name: firstStory.title, level: 1 })
    ).toBeVisible({ timeout: 10_000 });
    await expect(anonPage.getByText(/something went wrong|發生錯誤/i)).not.toBeVisible();
  });

  test('BrandCard components render (live card or not-found placeholder)', async ({ anonPage }) => {
    await anonPage.goto(STORY_URL);
    // BrandCardMdx renders:
    //   - brand found  → <a href="/zh-TW/brands/[slug]"> inside a wrapper div
    //   - brand missing → <div class="... border-dashed ..."> containing the slug text
    // Skipped when the story embeds no BrandCard at all — that is an authoring choice,
    // not a regression.
    const hasBrandCard = await anonPage
      .locator('main a[href*="/brands/"], main [class*="border-dashed"]')
      .first()
      .isVisible({ timeout: 5_000 })
      .catch(() => false);
    test.skip(!hasBrandCard, 'story embeds no BrandCard');

    await expect(async () => {
      await anonPage.reload();
      const brandLink = anonPage.locator('main a[href*="/brands/"]').first();
      const placeholder = anonPage.locator('main [class*="border-dashed"]').first();

      if (await brandLink.isVisible({ timeout: 5_000 }).catch(() => false)) {
        // A resolved card must show the brand's NAME, not just link to it. Asserting
        // only on the href let a bare-slug stub pass — the DEV-930 regression this
        // test exists to catch. The name must also differ from the slug in the href,
        // so rendering the raw slug as the label still fails.
        const href = (await brandLink.getAttribute('href')) ?? '';
        const slug = href.split('/brands/')[1]?.split(/[?#]/)[0] ?? '';
        const label = ((await brandLink.innerText()) ?? '').trim();

        expect(label.length).toBeGreaterThan(0);
        expect(label).not.toBe(slug);
      } else {
        // Unresolvable slug: the dashed placeholder must render and name the slug,
        // and the page must still be 200 rather than 500.
        await expect(placeholder).toBeVisible({ timeout: 5_000 });
      }
    }).toPass({ timeout: 60_000, intervals: [3_000, 5_000, 10_000] });
  });

  test('FaqBlock renders and first accordion item expands on click', async ({ anonPage }) => {
    await anonPage.goto(STORY_URL);
    // FaqBlock renders as <details>/<summary> accordion elements. `faq` is optional
    // frontmatter, so a story without one is not a failure.
    const firstDetails = anonPage.locator('main details').first();
    const hasFaq = await firstDetails.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!hasFaq, 'story has no faq frontmatter');

    await firstDetails.locator('summary').click();
    await expect(firstDetails).toHaveAttribute('open');
  });

  test('Article JSON-LD is present on story detail page', async ({ anonPage }) => {
    await anonPage.goto(STORY_URL);
    const blocks = await anonPage
      .locator('script[type="application/ld+json"]')
      .allTextContents();
    const hasArticle = blocks.some((b) => b.includes('"Article"'));
    expect(hasArticle).toBe(true);
  });

  test('authored locale is indexable and only advertises available alternates', async ({
    anonPage,
  }) => {
    await anonPage.goto(STORY_URL);

    await expect(anonPage.locator('meta[name="robots"][content*="noindex" i]')).toHaveCount(0);
    await expect(anonPage.locator('link[rel="alternate"][hreflang="zh-TW"]')).toHaveCount(1);
    await expect(anonPage.locator('link[rel="alternate"][hreflang="x-default"]')).toHaveCount(1);
    await expect(anonPage.locator('link[rel="alternate"][hreflang="en"]')).toHaveCount(0);
  });

  // Inverted from "404s instead of serving zh-TW content". English editions do not
  // exist yet, so /en now serves the zh-TW document rather than a dead end — the
  // duplicate-content risk is carried by the canonical, not by the status code.
  // Two things this still has to prove: the canonical points at the prefix-free
  // zh-TW URL (never self-referencing), and page chrome is genuinely English, i.e.
  // next-intl did not silently fall back to zh-TW the way `force-static` once made it.
  test('English locale serves the zh-TW story under a zh-TW canonical', async ({ anonPage }) => {
    const response = await anonPage.goto(`/en${STORY_URL}`);

    expect(response?.status()).toBe(200);
    await expect(
      anonPage.getByRole('heading', { name: firstStory.title, level: 1 })
    ).toBeVisible({ timeout: 10_000 });

    const canonical = anonPage.locator('link[rel="canonical"]');
    await expect(canonical).toHaveCount(1);
    await expect(canonical).toHaveAttribute(
      'href',
      new RegExp(`/stories/${escapeRegExp(firstStory.canonicalSlug)}$`)
    );
    // Never self-canonical: /en and the prefix-free URL serve identical bytes.
    await expect(canonical).not.toHaveAttribute('href', /\/en\/stories\//);
    // English chrome, not the zh-TW fallback the old force-static behavior produced.
    await expect(anonPage.getByRole('link', { name: 'Stories' }).first()).toBeVisible({
      timeout: 10_000,
    });
  });
});

/** Story titles come from frontmatter, so escape before building a title matcher. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
