import { test, expect } from '@playwright/test';

test.describe('Brand detail deep', () => {
  let brandSlug: string;

  test.beforeAll(async ({ browser }) => {
    // Get first brand href from brands directory — use goto(href) to avoid hydration race
    const page = await browser.newPage();
    await page.goto('/brands');
    const firstCard = page.locator('main a[aria-label]').first();
    await firstCard.waitFor({ state: 'visible', timeout: 10_000 });
    const href = await firstCard.getAttribute('href');
    await page.close();
    if (!href) {
      throw new Error('brand-detail: could not resolve a brand href from /brands. Ensure the DB has at least one approved brand.');
    }
    // href is now /brands/some-slug — keep as-is for goto()
    brandSlug = href.replace(/^\//, '');
  });

  test('all sections render without error', async ({ page }) => {
    await page.goto(`/${brandSlug}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 });
    // No error boundaries or 404
    await expect(page.getByText(/something went wrong|not found|error/i)).not.toBeVisible();
  });

  test('external links have target="_blank" and rel="noopener"', async ({ page }) => {
    await page.goto(`/${brandSlug}`);
    const externalLinks = page.locator('a[href^="http"]:not([href*="localhost"])');
    const count = await externalLinks.count();
    for (let i = 0; i < Math.min(count, 5); i++) {
      const link = externalLinks.nth(i);
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', /noopener/);
    }
  });

  test('SEO meta tags are present', async ({ page }) => {
    await page.goto(`/${brandSlug}`);
    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);
    const ogTitle = await page.locator('meta[property="og:title"]').getAttribute('content');
    expect(ogTitle?.length).toBeGreaterThan(0);
    const description = await page.locator('meta[name="description"]').getAttribute('content');
    expect(description?.length).toBeGreaterThan(0);
  });

  test('JSON-LD structured data is present', async ({ page }) => {
    await page.goto(`/${brandSlug}`);
    const jsonLd = await page.locator('script[type="application/ld+json"]').first().textContent();
    const parsed = JSON.parse(jsonLd || '{}');
    expect(parsed['@type']).toBeTruthy();
  });

  test('canonical URL matches current URL', async ({ page }) => {
    await page.goto(`/${brandSlug}`);
    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
    expect(canonical).toContain(brandSlug);
  });
});
