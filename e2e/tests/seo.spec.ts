import { test, expect } from '@playwright/test';

test.describe('SEO deep', () => {
  test('homepage has canonical URL', async ({ page }) => {
    await page.goto('/');
    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
    expect(canonical).toBeTruthy();
    expect(canonical).toMatch(/^https?:\/\//);
  });

  test('homepage has OG tags', async ({ page }) => {
    await page.goto('/');
    const ogTitle = await page.locator('meta[property="og:title"]').getAttribute('content');
    const ogDesc = await page.locator('meta[property="og:description"]').getAttribute('content');
    expect(ogTitle?.length).toBeGreaterThan(0);
    expect(ogDesc?.length).toBeGreaterThan(0);
  });

  test('robots.txt is accessible and allows crawling', async ({ request }) => {
    const response = await request.get('/robots.txt');
    expect(response.status()).toBe(200);
    const body = await response.text();
    // Next.js generates "User-Agent" (capital A) — compare case-insensitively
    expect(body.toLowerCase()).toContain('user-agent');
    expect(body).not.toMatch(/Disallow: \/$|Disallow: \*$/m);
  });

  test('sitemap.xml is accessible', async ({ request }) => {
    const response = await request.get('/sitemap.xml');
    expect(response.status()).toBe(200);
    const body = await response.text();
    expect(body).toContain('<urlset');
  });

  test('category page has unique title and description', async ({ page }) => {
    const categorySlug = process.env.E2E_CATEGORY_SLUG ?? 'clothing';
    await page.goto(`/categories/${categorySlug}`);
    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);
    const desc = await page.locator('meta[name="description"]').getAttribute('content');
    expect(desc?.length).toBeGreaterThan(0);
    // Title should not be the same as homepage
    await page.goto('/');
    const homeTitle = await page.title();
    expect(title).not.toBe(homeTitle);
  });

  // --- i18n: default-locale URL stability ---

  test('default zh-TW /brands returns 200 with no redirect', async ({ page }) => {
    const response = await page.goto('/brands');
    // Must be 200 — not a redirect to /zh-TW/brands
    expect(response?.status()).toBe(200);
    expect(page.url()).not.toContain('/zh-TW/');
  });

  test('default zh-TW / returns 200 with no redirect', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);
    expect(page.url()).not.toContain('/zh-TW/');
  });

  // --- i18n: hreflang alternates on localized pages ---

  test('/brands emits hreflang alternate links for zh-TW, en, and x-default', async ({ page }) => {
    await page.goto('/brands');
    // Next.js emits <link rel="alternate" hreflang="..."> via metadata.alternates.languages
    const zhAlternate = await page
      .locator('link[rel="alternate"][hreflang="zh-TW"]')
      .getAttribute('href');
    const enAlternate = await page
      .locator('link[rel="alternate"][hreflang="en"]')
      .getAttribute('href');
    const xDefault = await page
      .locator('link[rel="alternate"][hreflang="x-default"]')
      .getAttribute('href');

    expect(zhAlternate).toBeTruthy();
    expect(enAlternate).toBeTruthy();
    expect(xDefault).toBeTruthy();

    // zh-TW URL must be prefix-free (no /en/ segment)
    expect(zhAlternate).not.toContain('/en/');
    // en URL must be under /en/
    expect(enAlternate).toContain('/en/');
    // x-default should resolve to the zh-TW (prefix-free) URL
    expect(xDefault).not.toContain('/en/');
  });

  test('/en/brands emits hreflang alternate links', async ({ page }) => {
    await page.goto('/en/brands');
    const zhAlternate = await page
      .locator('link[rel="alternate"][hreflang="zh-TW"]')
      .getAttribute('href');
    const enAlternate = await page
      .locator('link[rel="alternate"][hreflang="en"]')
      .getAttribute('href');
    const xDefault = await page
      .locator('link[rel="alternate"][hreflang="x-default"]')
      .getAttribute('href');

    expect(zhAlternate).toBeTruthy();
    expect(enAlternate).toBeTruthy();
    expect(xDefault).toBeTruthy();
  });

  test('/brands has a canonical link pointing to the zh-TW (prefix-free) URL', async ({ page }) => {
    await page.goto('/brands');
    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
    expect(canonical).toBeTruthy();
    expect(canonical).toMatch(/^https?:\/\//);
    // Canonical for default locale must NOT include /en/
    expect(canonical).not.toContain('/en/');
  });

  test('/en/brands has a canonical link pointing to the /en/ URL', async ({ page }) => {
    await page.goto('/en/brands');
    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
    expect(canonical).toBeTruthy();
    expect(canonical).toContain('/en/');
  });
});
