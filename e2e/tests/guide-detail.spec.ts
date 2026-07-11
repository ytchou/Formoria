import { test, expect } from '../fixtures/auth';

const GUIDE_URL = '/guides/taiwan-skincare-brands';

test.describe('Guide detail deep', () => {
  test('guide page renders title and no error boundary', async ({ anonPage }) => {
    await anonPage.goto(GUIDE_URL);
    await expect(anonPage).toHaveTitle(/台灣護膚品牌推薦/);
    await expect(
      anonPage.getByRole('heading', { name: '台灣護膚品牌推薦', level: 1 })
    ).toBeVisible({ timeout: 10_000 });
    await expect(anonPage.getByText(/something went wrong|發生錯誤/i)).not.toBeVisible();
  });

  test('BrandCard components render (live card or not-found placeholder)', async ({ anonPage }) => {
    await anonPage.goto(GUIDE_URL);
    // BrandCardMdx renders:
    //   - brand found  → <a href="/zh-TW/brands/[slug]"> inside a wrapper div
    //   - brand missing → <div class="... border-dashed ..."> containing the slug text
    // Guide MDX embeds three BrandCards: skin-verse, cha-zi-tang, daylily
    await expect(async () => {
      await anonPage.reload();
      const brandElement = anonPage
        .locator('main a[href*="/brands/"], main [class*="border-dashed"]')
        .first();
      await expect(brandElement).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 60_000, intervals: [3_000, 5_000, 10_000] });
  });

  test('FaqBlock renders and first accordion item expands on click', async ({ anonPage }) => {
    await anonPage.goto(GUIDE_URL);
    // FaqBlock renders as <details>/<summary> accordion elements
    const firstDetails = anonPage.locator('main details').first();
    await expect(firstDetails).toBeVisible({ timeout: 10_000 });
    await firstDetails.locator('summary').click();
    await expect(firstDetails).toHaveAttribute('open');
  });

  test('Article JSON-LD is present on guide detail page', async ({ anonPage }) => {
    await anonPage.goto(GUIDE_URL);
    const blocks = await anonPage
      .locator('script[type="application/ld+json"]')
      .allTextContents();
    const hasArticle = blocks.some((b) => b.includes('"Article"'));
    expect(hasArticle).toBe(true);
  });

  test('FAQPage JSON-LD is present on guide detail page', async ({ anonPage }) => {
    await anonPage.goto(GUIDE_URL);
    const blocks = await anonPage
      .locator('script[type="application/ld+json"]')
      .allTextContents();
    const hasFaqPage = blocks.some((b) => b.includes('"FAQPage"'));
    expect(hasFaqPage).toBe(true);
  });
});
