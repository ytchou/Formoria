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

  test('eligible brand locales are indexed with reciprocal canonical and hreflang links', async ({
    page,
    request,
  }) => {
    const sitemapResponse = await request.get('/sitemap.xml');
    expect(sitemapResponse.status()).toBe(200);
    const sitemap = await sitemapResponse.text();
    const locations = Array.from(sitemap.matchAll(/<loc>([^<]+)<\/loc>/g), (match) => match[1]);
    const zhBrandUrl = locations.find((location) => {
      const url = new URL(location);
      return (
        url.pathname.startsWith('/brands/') && locations.includes(`${url.origin}/en${url.pathname}`)
      );
    });

    expect(zhBrandUrl, 'expected at least one brand eligible in both locales').toBeTruthy();
    const zhUrl = new URL(zhBrandUrl!);
    const enUrl = `${zhUrl.origin}/en${zhUrl.pathname}`;

    for (const [path, canonicalUrl] of [
      [zhUrl.pathname, zhUrl.toString()],
      [`/en${zhUrl.pathname}`, enUrl],
    ]) {
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);

      const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
      expect(canonical).toBe(canonicalUrl);
      await expect(page.locator('meta[name="robots"][content*="noindex" i]')).toHaveCount(0);
      await expect(page.locator('link[rel="alternate"][hreflang="zh-TW"]')).toHaveAttribute(
        'href',
        zhUrl.toString(),
      );
      await expect(page.locator('link[rel="alternate"][hreflang="en"]')).toHaveAttribute(
        'href',
        enUrl,
      );
      await expect(page.locator('link[rel="alternate"][hreflang="x-default"]')).toHaveAttribute(
        'href',
        zhUrl.toString(),
      );
    }
  });

  test('category page has unique title and description', async ({ page }) => {
    const categorySlug = process.env.E2E_CATEGORY_SLUG ?? 'clothing';
    await page.goto(`/brands?category=${categorySlug}`);
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

  test('robots allows /submit', async ({ request }) => {
    const body = await (await request.get('/robots.txt')).text();
    expect(body).not.toMatch(/Disallow:\s*\/submit\b/);
  });

  test('sitemap includes /glossary', async ({ request }) => {
    const body = await (await request.get('/sitemap.xml')).text();
    expect(body).toContain('/glossary');
  });

  test('llms.txt is served as text', async ({ request }) => {
    const res = await request.get('/llms.txt');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('text/plain');
    expect(await res.text()).toContain('/glossary');
  });

  test('/brands (unfiltered) emits ItemList JSON-LD with itemListElement', async ({ page }) => {
    await page.goto('/brands');
    const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
    // The unfiltered /brands page emits an ItemList block alongside the WebSite block
    const itemListBlock = blocks.find((b) => b.includes('"ItemList"'));
    expect(itemListBlock).toBeTruthy();
    // itemListElement array must be present (may be empty if no approved brands exist)
    expect(itemListBlock).toContain('"itemListElement"');
    // When approved brands exist, verify the first element has required fields
    if (itemListBlock?.includes('"position"')) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parsed = JSON.parse(itemListBlock) as any;
      const first = parsed.itemListElement?.[0];
      expect(typeof first?.position).toBe('number');
      expect(typeof first?.name).toBe('string');
      expect(String(first?.url)).toContain('/brands/');
    }
  });

  // DEV-1032: subcategory filter — canonical must always point to the parent category
  // (sub= param must never leak into the canonical URL)
  test('subcategory view canonical points to parent category', async ({ page }) => {
    const E2E_CATEGORY_SLUG = 'bags-accessories';
    const E2E_SUB_SLUG = 'clasp-frame-bags';
    await page.goto(`/brands?category=${E2E_CATEGORY_SLUG}&sub=${E2E_SUB_SLUG}`);
    const canonical = page.locator('link[rel="canonical"]');
    // The canonical must end with ?category=<slug> — no sub= param
    await expect(canonical).toHaveAttribute(
      'href',
      new RegExp(`/brands\\?category=${E2E_CATEGORY_SLUG}$`),
    );
  });

});
