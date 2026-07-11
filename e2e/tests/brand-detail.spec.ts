import { test, expect } from '@playwright/test';
import { seedBrand, SeededBrand } from "../helpers/seed";

test.describe('Brand detail deep', () => {
  let brandHref: string;
  let seeded: SeededBrand;

  test.beforeAll(async ({}, workerInfo) => {
    seeded = await seedBrand({
      name: "detail",
      status: "approved",
      workerIndex: workerInfo.workerIndex,
      withLinks: true,
      withOwner: true,
    });
  });

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto('/brands', { waitUntil: 'domcontentloaded' });
    const cards = page.locator('main a[aria-label]');
    await cards.first().waitFor({ state: 'visible', timeout: 15_000 });
    const count = await cards.count();
    let href: string | null = null;
    for (let i = 0; i < count; i++) {
      const h = await cards.nth(i).getAttribute('href');
      if (h && /^\/brands\/[\w-]+$/.test(h)) {
        href = h;
        break;
      }
    }
    await page.close();
    brandHref = href ?? `/brands/${seeded.slug}`;
  });

  test.afterAll(async () => {
    await seeded.cleanup();
  });

  test('all sections render without error', async ({ page }) => {
    await page.goto(brandHref);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 });
    // No error boundaries or 404
    await expect(page.getByText(/something went wrong|not found|error|發生錯誤/i)).not.toBeVisible();
  });

  test('brand detail shows social and purchase links in two separate sections', async ({ page }) => {
    // Use a known brand that has links data to verify two-section structure.
    // Fall back to the dynamically resolved href if the known brand is absent.
    await page.goto(`/brands/${seeded.slug}`);

    // Verify the social section heading is visible
    await expect(
      page.getByRole('heading', { name: '社群平台', level: 2 })
    ).toBeVisible({ timeout: 10_000 });

    // Verify the purchase section heading is visible
    await expect(
      page.getByRole('heading', { name: '購買管道', level: 2 })
    ).toBeVisible({ timeout: 10_000 });

    // Both sections must appear on the same page — confirming structural separation
    const socialSection = page.getByRole('heading', { name: '社群平台', level: 2 });
    const purchaseSection = page.getByRole('heading', { name: '購買管道', level: 2 });
    await expect(socialSection).toBeVisible();
    await expect(purchaseSection).toBeVisible();
  });

  test('links sections are structurally separate (social before purchase)', async ({ page }) => {
    await page.goto(`/brands/${seeded.slug}`);

    const socialHeading = page.getByRole('heading', { name: '社群平台', level: 2 });
    const purchaseHeading = page.getByRole('heading', { name: '購買管道', level: 2 });

    await expect(socialHeading).toBeVisible({ timeout: 10_000 });
    await expect(purchaseHeading).toBeVisible();

    // Social section must appear before purchase section in document order
    const socialBox = await socialHeading.boundingBox();
    const purchaseBox = await purchaseHeading.boundingBox();
    expect(socialBox).not.toBeNull();
    expect(purchaseBox).not.toBeNull();
    expect(socialBox!.y).toBeLessThan(purchaseBox!.y);
  });

  test('external links have target="_blank" and rel="noopener"', async ({ page }) => {
    await page.goto(brandHref);
    const externalLinks = page.locator('a[href^="http"]:not([href*="localhost"])');
    const count = await externalLinks.count();
    for (let i = 0; i < Math.min(count, 5); i++) {
      const link = externalLinks.nth(i);
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', /noopener/);
    }
  });

  test('SEO meta tags are present', async ({ page }) => {
    await page.goto(brandHref);
    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);
    const ogTitle = await page.locator('meta[property="og:title"]').getAttribute('content');
    expect(ogTitle?.length).toBeGreaterThan(0);
    const description = await page.locator('meta[name="description"]').getAttribute('content');
    expect(description?.length).toBeGreaterThan(0);
  });

  test('JSON-LD structured data is present', async ({ page }) => {
    await page.goto(brandHref);
    const jsonLd = await page.locator('script[type="application/ld+json"]').first().textContent();
    const parsed = JSON.parse(jsonLd || '{}');
    expect(parsed['@type']).toBeTruthy();
  });

  test('canonical URL matches current URL', async ({ page }) => {
    await page.goto(brandHref);
    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
    expect(decodeURIComponent(canonical ?? '')).toContain(decodeURIComponent(brandHref));
  });

  test('FAQ accordion and FAQPage JSON-LD render on a data-rich brand', async ({ page }) => {
    // Seeded with purchase links and social accounts — FAQ conditions are met
    // (verified by existing "social and purchase links" test which asserts both sections on this slug)
    await page.goto(`/brands/${seeded.slug}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 });

    // FAQ section heading is visible (zh-TW default locale — no prefix, brandFaq.sectionTitle = '常見問題')
    await expect(
      page.getByRole('heading', { name: '常見問題', level: 2 })
    ).toBeVisible({ timeout: 10_000 });

    // At least one accordion trigger (FAQ item) is present and visible
    await expect(
      page.locator('[data-slot="accordion-trigger"]').first()
    ).toBeVisible();

    // FAQPage JSON-LD block is appended after the Organization and Breadcrumb blocks
    const jsonLdTexts = await page
      .locator('script[type="application/ld+json"]')
      .evaluateAll((els) => els.map((el) => el.textContent ?? ''));
    const faqLdText = jsonLdTexts.find((t) => t.includes('"FAQPage"'));
    expect(faqLdText).toBeDefined();
    const faqLd = JSON.parse(faqLdText!);
    expect(faqLd['@type']).toBe('FAQPage');
    expect(Array.isArray(faqLd.mainEntity)).toBe(true);
    expect(faqLd.mainEntity.length).toBeGreaterThan(0);
  });
});
