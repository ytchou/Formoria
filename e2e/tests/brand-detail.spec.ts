import { test, expect } from '@playwright/test';

test.describe('Brand detail deep', () => {
  let brandSlug: string;

  test.beforeAll(async ({ browser }) => {
    // Get first brand slug from homepage
    const page = await browser.newPage();
    await page.goto('/');
    const firstCard = page.locator('[data-testid="brand-card"]').first();
    await firstCard.click();
    brandSlug = new URL(page.url()).pathname.replace('/', '');
    await page.close();
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
