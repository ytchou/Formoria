import { BUDGET, POLL } from '../budgets';
import { test, expect } from '../fixtures/auth';
import { NO_PUBLISHED_STORIES, publishedStories } from '../utils/published-stories';

// Editorial content lives in `content/stories/`, which ships empty — every test here
// needs a real published story, so the whole group gates on content presence and skips
// cleanly until one is merged. Slug and title are read from the content directory rather
// than hardcoded, so the first story that lands turns this suite green with no edit.
const stories = publishedStories('zh-TW');
const firstStory = stories[0];
const STORY_URL = firstStory ? `/stories/${firstStory.slug}` : '/stories';

/**
 * Explicit fixtures for the two component-specific tests below. Both used to run
 * against `stories[0]` and skip themselves when it did not happen to embed the
 * thing they assert on — so the component was covered or not depending on
 * `readdirSync` ordering, and the report said "passed" either way (DEV-1414).
 *
 * Selection is by content, not by position: the first published story whose body
 * embeds a `<BrandCard`, and the first with `faq` frontmatter. When no story
 * qualifies the test skips with that as its stated reason, which is a genuine
 * content gate — the same class as NO_PUBLISHED_STORIES.
 */
const BRAND_CARD_STORY = stories.find((story) => story.body.includes('<BrandCard'));
const FAQ_STORY = stories.find((story) => story.hasFaq);

test.describe('Story detail deep', () => {
  test.beforeEach(() => {
    test.skip(stories.length === 0, NO_PUBLISHED_STORIES);
  });

  test('story page renders title and no error boundary', async ({ anonPage }) => {
    await anonPage.goto(STORY_URL);
    await expect(anonPage).toHaveTitle(new RegExp(escapeRegExp(firstStory.title)));
    await expect(
      anonPage.getByRole('heading', { name: firstStory.title, level: 1 })
    ).toBeVisible({ timeout: BUDGET.INTERACTIVE });
    await expect(anonPage.getByText(/something went wrong|發生錯誤/i)).not.toBeVisible();
  });

  test('BrandCard components render (live card or not-found placeholder)', async ({ anonPage }) => {
    // Pinned to a story that actually embeds BrandCards, rather than to whichever
    // story `readdirSync` returns first. The old shape was a triple conditional —
    // skip if no stories, skip if the first story has no BrandCard, then branch on
    // `isVisible()` — so the one regression this test names (DEV-930's bare-slug
    // stub) was covered only when the directory listing happened to cooperate
    // (DEV-1414).
    test.skip(
      BRAND_CARD_STORY === undefined,
      'no published story embeds a BrandCard',
    );
    await anonPage.goto(`/stories/${BRAND_CARD_STORY!.slug}`);

    // BrandCardMdx renders:
    //   - brand found  → <a href="/zh-TW/brands/[slug]"> inside a wrapper div
    //   - brand missing → <div class="... border-dashed ..."> containing the slug text
    // Asserted, not guarded: the story is known to embed one, so nothing rendering
    // is a failure rather than a reason to stop.
    await expect(
      anonPage
        .locator('main a[href*="/brands/"], main [class*="border-dashed"]')
        .first(),
    ).toBeVisible({ timeout: BUDGET.RENDERED });

    await expect(async () => {
      await anonPage.reload();
      const brandLink = anonPage.locator('main a[href*="/brands/"]').first();
      const placeholder = anonPage.locator('main [class*="border-dashed"]').first();

      if (await brandLink.isVisible({ timeout: BUDGET.RENDERED }).catch(() => false)) {
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
        await expect(placeholder).toBeVisible({ timeout: BUDGET.RENDERED });
      }
    }).toPass(POLL.DB);
  });

  test('FaqBlock renders and first accordion item expands on click', async ({ anonPage }) => {
    // `faq` is optional frontmatter, so "no story has one" is a content state, not a
    // failure — but it is now read off the frontmatter rather than inferred from
    // whether a <details> happened to be visible on an arbitrary story.
    test.skip(FAQ_STORY === undefined, 'no published story has faq frontmatter');
    await anonPage.goto(`/stories/${FAQ_STORY!.slug}`);

    // FaqBlock renders as <details>/<summary> accordion elements. The story is known
    // to declare one, so its absence is a rendering regression.
    const firstDetails = anonPage.locator('main details').first();
    await expect(firstDetails).toBeVisible({ timeout: BUDGET.RENDERED });

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
    ).toBeVisible({ timeout: BUDGET.INTERACTIVE });

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
      timeout: BUDGET.INTERACTIVE,
    });
  });
});

/** Story titles come from frontmatter, so escape before building a title matcher. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
