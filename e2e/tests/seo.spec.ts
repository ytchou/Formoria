import { test, expect } from "@playwright/test";

import { BUDGET } from "../budgets";
// `property`/`name` and `content` can appear in either order in the rendered
// tag, so match the whole `<meta ...>` element first and pull `content` out
// of it rather than assuming attribute order.
function extractMetaContent(
  html: string,
  propertyOrName: string,
): string | null {
  const tagMatch = html.match(
    new RegExp(
      `<meta[^>]*(?:property|name)=["']${propertyOrName}["'][^>]*>`,
      "i",
    ),
  );
  if (!tagMatch) return null;
  const contentMatch = tagMatch[0].match(/content=["']([^"']*)["']/i);
  return contentMatch ? contentMatch[1] : null;
}

test.describe("SEO deep", () => {
  test("homepage has canonical URL", async ({ page }) => {
    await page.goto("/");
    const canonical = await page
      .locator('link[rel="canonical"]')
      .getAttribute("href");
    expect(canonical).toBeTruthy();
    expect(canonical).toMatch(/^https?:\/\//);
  });

  test("homepage has OG tags", async ({ page }) => {
    await page.goto("/");
    const ogTitle = await page
      .locator('meta[property="og:title"]')
      .getAttribute("content");
    const ogDesc = await page
      .locator('meta[property="og:description"]')
      .getAttribute("content");
    expect(ogTitle?.length).toBeGreaterThan(0);
    expect(ogDesc?.length).toBeGreaterThan(0);
  });

  test("robots.txt is accessible and allows crawling", async ({ request }) => {
    const response = await request.get("/robots.txt");
    expect(response.status()).toBe(200);
    const body = await response.text();
    // Next.js generates "User-Agent" (capital A) — compare case-insensitively
    expect(body.toLowerCase()).toContain("user-agent");
    expect(body).not.toMatch(/Disallow: \/$|Disallow: \*$/m);
  });

  test("sitemap.xml is accessible", async ({ request }) => {
    const response = await request.get("/sitemap.xml");
    expect(response.status()).toBe(200);
    const body = await response.text();
    expect(body).toContain("<urlset");
  });

  test("eligible brand locales are indexed with reciprocal canonical and hreflang links", async ({
    page,
    request,
  }) => {
    const sitemapResponse = await request.get("/sitemap.xml");
    expect(sitemapResponse.status()).toBe(200);
    const sitemap = await sitemapResponse.text();
    const locations = Array.from(
      sitemap.matchAll(/<loc>([^<]+)<\/loc>/g),
      (match) => match[1],
    );
    const zhBrandUrl = locations.find((location) => {
      const url = new URL(location);
      return (
        url.pathname.startsWith("/brands/") &&
        locations.includes(`${url.origin}/en${url.pathname}`)
      );
    });

    expect(
      zhBrandUrl,
      "expected at least one brand eligible in both locales",
    ).toBeTruthy();
    const zhUrl = new URL(zhBrandUrl!);
    const enUrl = `${zhUrl.origin}/en${zhUrl.pathname}`;

    for (const [path, canonicalUrl] of [
      [zhUrl.pathname, zhUrl.toString()],
      [`/en${zhUrl.pathname}`, enUrl],
    ]) {
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);

      const canonical = await page
        .locator('link[rel="canonical"]')
        .getAttribute("href");
      expect(canonical).toBe(canonicalUrl);
      await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
        "content",
        canonicalUrl,
      );
      await expect(page.locator('meta[property="og:type"]')).toHaveAttribute(
        "content",
        "website",
      );
      await expect(
        page.locator('meta[property="og:image:alt"]'),
      ).toHaveAttribute("content", /.+/);
      await expect(
        page.locator('meta[property="og:image:width"]'),
      ).toHaveAttribute("content", /^[1-9]\d*$/);
      await expect(
        page.locator('meta[property="og:image:height"]'),
      ).toHaveAttribute("content", /^[1-9]\d*$/);
      await expect(
        page.locator('meta[name="robots"][content*="noindex" i]'),
      ).toHaveCount(0);
      await expect(
        page.locator('link[rel="alternate"][hreflang="zh-TW"]'),
      ).toHaveAttribute("href", zhUrl.toString());
      await expect(
        page.locator('link[rel="alternate"][hreflang="en"]'),
      ).toHaveAttribute("href", enUrl);
      await expect(
        page.locator('link[rel="alternate"][hreflang="x-default"]'),
      ).toHaveAttribute("href", zhUrl.toString());
    }
  });

  test("directory page 2 keeps its page query in canonical metadata", async ({
    page,
  }) => {
    await page.goto("/brands?page=2");
    const canonical = await page
      .locator('link[rel="canonical"]')
      .getAttribute("href");
    const ogUrl = await page
      .locator('meta[property="og:url"]')
      .getAttribute("content");

    expect(canonical).toMatch(/\?.*page=2(?:&|$)/);
    expect(ogUrl).toBe(canonical);
  });

  test("an unknown eligible bare slug returns a direct 404", async ({
    request,
  }) => {
    const unknownSlug = `e2e-unknown-brand-${Date.now()}`;
    const response = await request.get(`/${unknownSlug}`, { maxRedirects: 0 });

    expect(response.status()).toBe(404);
    expect(response.headers().location).toBeUndefined();
  });

  // --- i18n: default-locale URL stability ---

  test("default zh-TW /brands returns 200 with no redirect", async ({
    page,
  }) => {
    const response = await page.goto("/brands");
    // Must be 200 — not a redirect to /zh-TW/brands
    expect(response?.status()).toBe(200);
    expect(page.url()).not.toContain("/zh-TW/");
  });

  test("default zh-TW / returns 200 with no redirect", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
    expect(page.url()).not.toContain("/zh-TW/");
  });

  // --- i18n: hreflang alternates on localized pages ---

  test("/brands emits hreflang alternate links for zh-TW, en, and x-default", async ({
    page,
  }) => {
    await page.goto("/brands");
    // Next.js emits <link rel="alternate" hreflang="..."> via metadata.alternates.languages
    const zhAlternate = await page
      .locator('link[rel="alternate"][hreflang="zh-TW"]')
      .getAttribute("href");
    const enAlternate = await page
      .locator('link[rel="alternate"][hreflang="en"]')
      .getAttribute("href");
    const xDefault = await page
      .locator('link[rel="alternate"][hreflang="x-default"]')
      .getAttribute("href");

    expect(zhAlternate).toBeTruthy();
    expect(enAlternate).toBeTruthy();
    expect(xDefault).toBeTruthy();

    // zh-TW URL must be prefix-free (no /en/ segment)
    expect(zhAlternate).not.toContain("/en/");
    // en URL must be under /en/
    expect(enAlternate).toContain("/en/");
    // x-default should resolve to the zh-TW (prefix-free) URL
    expect(xDefault).not.toContain("/en/");
  });

  test("/en/brands emits hreflang alternate links", async ({ page }) => {
    await page.goto("/en/brands");
    const zhAlternate = await page
      .locator('link[rel="alternate"][hreflang="zh-TW"]')
      .getAttribute("href");
    const enAlternate = await page
      .locator('link[rel="alternate"][hreflang="en"]')
      .getAttribute("href");
    const xDefault = await page
      .locator('link[rel="alternate"][hreflang="x-default"]')
      .getAttribute("href");

    expect(zhAlternate).toBeTruthy();
    expect(enAlternate).toBeTruthy();
    expect(xDefault).toBeTruthy();
  });

  test("/brands has a canonical link pointing to the zh-TW (prefix-free) URL", async ({
    page,
  }) => {
    await page.goto("/brands");
    const canonical = await page
      .locator('link[rel="canonical"]')
      .getAttribute("href");
    expect(canonical).toBeTruthy();
    expect(canonical).toMatch(/^https?:\/\//);
    // Canonical for default locale must NOT include /en/
    expect(canonical).not.toContain("/en/");
  });

  test("/en/brands has a canonical link pointing to the /en/ URL", async ({
    page,
  }) => {
    await page.goto("/en/brands");
    const canonical = await page
      .locator('link[rel="canonical"]')
      .getAttribute("href");
    expect(canonical).toBeTruthy();
    expect(canonical).toContain("/en/");
  });

  test("robots allows /submit", async ({ request }) => {
    const body = await (await request.get("/robots.txt")).text();
    expect(body).not.toMatch(/Disallow:\s*\/submit\b/);
  });

  test("sitemap includes the public editorial pages", async ({ request }) => {
    const body = await (await request.get("/sitemap.xml")).text();
    expect(body).toContain("/about");
    expect(body).not.toContain("/vision");
  });

  test("sitemap static pages expose a resolvable PNG OG image", async ({
    request,
  }) => {
    // The sitemap includes every locale and category variant; in a full dev
    // run those route bundles may still compile lazily after the other SEO
    // journeys have exercised the server. Keep the budget local to this sweep.
    test.setTimeout(BUDGET.TEST.ADMIN);
    const sitemapResponse = await request.get("/sitemap.xml");
    expect(sitemapResponse.status()).toBe(200);
    const sitemap = await sitemapResponse.text();
    const locations = Array.from(
      sitemap.matchAll(/<loc>([^<]+)<\/loc>/g),
      (match) => new URL(match[1]),
    );
    const staticPaths = new Set([
      "/",
      "/brands",
      "/events",
      "/about",
      "/faq",
      "/contact",
      "/terms",
      "/privacy",
      "/getting-started",
      "/submit",
    ]);
    const staticLocations = locations.filter((url) => {
      const path =
        url.pathname === "/en" ? "/" : url.pathname.replace(/^\/en(?=\/)/, "");
      return staticPaths.has(path) || path.startsWith("/categories/");
    });

    expect(staticLocations.length).toBeGreaterThan(0);
    // A browser render per URL exceeds the CI timeout, while compiling every
    // route concurrently can overload a cold dev server and corrupt its route
    // manifests. Plain HTTP requests in small batches keep all URL assertions
    // while bounding lazy compilation pressure.
    const batchSize = 4;
    for (let index = 0; index < staticLocations.length; index += batchSize) {
      const batch = staticLocations.slice(index, index + batchSize);
      await Promise.all(
        batch.map(async (url) => {
          const path = `${url.pathname}${url.search}`;
          const pageResponse = await request.get(path);
          expect(pageResponse.status(), `${path} → status`).toBe(200);
          const html = await pageResponse.text();

          const ogImage = extractMetaContent(html, "og:image");
          expect(ogImage, `${path} → og:image`).toMatch(/^https?:\/\//);

          const imageUrl = new URL(ogImage!);
          const localImageUrl = `${url.origin}${imageUrl.pathname}${imageUrl.search}`;
          const imageResponse = await request.get(localImageUrl);
          expect(imageResponse.status(), `${path} → og:image status`).toBe(200);
          expect(
            imageResponse.headers()["content-type"],
            `${path} → og:image content-type`,
          ).toMatch(/^image\/png(?:;|$)/);

          if (
            url.pathname.replace(/^\/en(?=\/)/, "").startsWith("/categories/")
          ) {
            expect(
              extractMetaContent(html, "twitter:card"),
              `${path} → twitter:card`,
            ).toBe("summary_large_image");
          }
        }),
      );
    }
  });

  test("llms.txt is served as text", async ({ request }) => {
    const res = await request.get("/llms.txt");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/plain");
    const body = await res.text();
    expect(body).toContain("/about");
    expect(body).not.toContain("/vision");
  });

  test("llms.txt lists canonical category and reference links", async ({
    request,
  }) => {
    const body = await (await request.get("/llms.txt")).text();
    const categorySlugs = [
      "fashion",
      "bags-accessories",
      "jewelry",
      "beauty",
      "home",
      "food-drink",
      "crafts",
      "stationery",
      "tech",
      "outdoor",
      "fitness",
      "kids-pets",
    ];

    for (const slug of categorySlugs) {
      expect(body).toContain(`/categories/${slug}`);
      expect(body).not.toContain(`/brands?category=${slug}`);
    }
    for (const path of ["/events", "/faq"]) {
      expect(body).toContain(path);
    }
  });

  test("challenge page is not indexed or followed", async ({ page }) => {
    await page.goto("/challenge");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      /noindex/i,
    );
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      /nofollow/i,
    );
  });

  test("/brands (unfiltered) emits ItemList JSON-LD with itemListElement", async ({
    page,
  }) => {
    await page.goto("/brands");
    const blocks = await page
      .locator('script[type="application/ld+json"]')
      .allTextContents();
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
      expect(typeof first?.position).toBe("number");
      expect(typeof first?.name).toBe("string");
      expect(String(first?.url)).toContain("/brands/");
    }
  });
});
