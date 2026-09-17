import { describe, expect, it } from "vitest";

import {
  assertBrandPage,
  assertCategory,
  assertEnglishLocale,
  assertOgImage,
  assertOriginGuard,
  assertRobots,
  assertSitemap,
  BROWSER_USER_AGENT,
  BRAND_URL_FLOOR,
  runRepeatSafeAssertions,
  type AssertionContext,
} from "../surface-assertions";

// ── Helpers ─────────────────────────────────────────────────────────────────

interface StubRoute {
  body: string;
  status: number;
  headers?: Record<string, string>;
}

type RouteHandler = StubRoute | ((url: string, init?: RequestInit) => StubRoute);

/**
 * Routing mock fetch that records every call for UA inspection. Routes are
 * matched by substring, first match wins.
 */
function createMockFetch(routes: Array<[pattern: string, handler: RouteHandler]>): {
  fetch: typeof fetch;
  calls: Array<{ url: string; headers: Headers }>;
} {
  const calls: Array<{ url: string; headers: Headers }> = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    const requestHeaders = new Headers(init?.headers);
    calls.push({ url, headers: requestHeaders });
    for (const [pattern, handler] of routes) {
      if (url.includes(pattern)) {
        const route =
          typeof handler === "function" ? handler(url, init) : handler;
        return new Response(route.body, {
          status: route.status,
          headers: route.headers,
        });
      }
    }
    return new Response("Not found", { status: 404 });
  }) as unknown as typeof fetch;
  return { fetch: fetchFn, calls };
}

function ctx(fetchImpl: typeof fetch): AssertionContext {
  return { baseUrl: "https://example.com", fetch: fetchImpl };
}

function brandUrl(slug: string): string {
  return `<url><loc>https://example.com/brands/${slug}</loc></url>`;
}

function sitemap(brandCount: number): string {
  const urls = Array.from({ length: brandCount }, (_, i) =>
    brandUrl(`brand-${i}`),
  ).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;
}

const HEALTHY_HEALTH_BODY = JSON.stringify({
  originGuard: "enabled",
  rateLimitStore: "ok",
  status: "ok",
});

const HEALTHY_BRAND_PAGE = `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta property="og:image" content="https://example.com/i/brands/abc/hero.webp" />
  <script type="application/ld+json">{"@type":"LocalBusiness","name":"Test"}</script>
</head>
<body>
  <a href="https://shop.example.com/buy">購買</a>
</body>
</html>`;

const CATEGORY_PAGE_WITH_CANONICAL = `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <link rel="canonical" href="https://formoria.com/brands?category=home" />
</head>
<body>Home category</body>
</html>`;

// ── Tests ───────────────────────────────────────────────────────────────────

describe("assertSitemap", () => {
  it("sitemap assertion fails on zero brand URLs and passes above the floor", async () => {
    const empty = createMockFetch([
      ["/sitemap.xml", { body: sitemap(0), status: 200 }],
    ]);
    const failResults = await assertSitemap(ctx(empty.fetch));
    expect(failResults.some((r) => !r.ok)).toBe(true);

    const full = createMockFetch([
      ["/sitemap.xml", { body: sitemap(BRAND_URL_FLOOR + 1), status: 200 }],
    ]);
    const passResults = await assertSitemap(ctx(full.fetch));
    expect(passResults.every((r) => r.ok)).toBe(true);
  });
});

describe("assertRobots", () => {
  it("robots assertion fails on a blanket Disallow: /", async () => {
    const blocked = createMockFetch([
      [
        "/robots.txt",
        {
          body: "User-agent: *\nDisallow: /\n",
          status: 200,
        },
      ],
    ]);
    const failResults = await assertRobots(ctx(blocked.fetch));
    expect(failResults.some((r) => !r.ok)).toBe(true);

    const allowed = createMockFetch([
      [
        "/robots.txt",
        {
          body: "User-agent: *\nAllow: /\nDisallow: /admin/\n",
          status: 200,
        },
      ],
    ]);
    const passResults = await assertRobots(ctx(allowed.fetch));
    expect(passResults.every((r) => r.ok)).toBe(true);
  });
});

describe("assertOgImage", () => {
  it("og:image assertion fails when the image URL is not 200 or not an image content-type", async () => {
    // Image returns 404
    const notFound = createMockFetch([
      [
        "/brands/test-brand",
        {
          body: '<html><head><meta property="og:image" content="https://example.com/i/brands/abc/hero.webp" /></head></html>',
          status: 200,
        },
      ],
      ["/i/brands/abc/hero.webp", { body: "", status: 404 }],
    ]);
    const failStatus = await assertOgImage(
      ctx(notFound.fetch),
      "https://example.com/brands/test-brand",
    );
    expect(failStatus.some((r) => !r.ok)).toBe(true);

    // Image returns 200 but wrong content-type
    const wrongType = createMockFetch([
      [
        "/brands/test-brand",
        {
          body: '<html><head><meta property="og:image" content="https://example.com/i/brands/abc/hero.webp" /></head></html>',
          status: 200,
        },
      ],
      [
        "/i/brands/abc/hero.webp",
        {
          body: "<html>not an image</html>",
          status: 200,
          headers: { "content-type": "text/html" },
        },
      ],
    ]);
    const failType = await assertOgImage(
      ctx(wrongType.fetch),
      "https://example.com/brands/test-brand",
    );
    expect(failType.some((r) => !r.ok)).toBe(true);

    // Image returns 200 with image content-type
    const success = createMockFetch([
      [
        "/brands/test-brand",
        {
          body: '<html><head><meta property="og:image" content="https://example.com/i/brands/abc/hero.webp" /></head></html>',
          status: 200,
        },
      ],
      [
        "/i/brands/abc/hero.webp",
        {
          body: "PNG...",
          status: 200,
          headers: { "content-type": "image/webp" },
        },
      ],
    ]);
    const passResults = await assertOgImage(
      ctx(success.fetch),
      "https://example.com/brands/test-brand",
    );
    expect(passResults.every((r) => r.ok)).toBe(true);
  });
});

describe("assertEnglishLocale", () => {
  it("english locale assertion fails when /en/brands renders the zh-TW string", async () => {
    // Page accidentally renders zh-TW content
    const zhTW = createMockFetch([
      [
        "/en/brands",
        {
          body: '<html lang="zh-TW"><head><title>品牌目錄</title></head><body>探索品牌</body></html>',
          status: 200,
        },
      ],
    ]);
    const failResults = await assertEnglishLocale(ctx(zhTW.fetch));
    expect(failResults.some((r) => !r.ok)).toBe(true);

    // Page correctly renders English
    const en = createMockFetch([
      [
        "/en/brands",
        {
          body: '<html lang="en"><head><title>Brand Directory</title></head><body>Explore brands</body></html>',
          status: 200,
        },
      ],
    ]);
    const passResults = await assertEnglishLocale(ctx(en.fetch));
    expect(passResults.every((r) => r.ok)).toBe(true);
  });
});

describe("assertCategory", () => {
  it("category assertion runs under both Accept headers and fails if either is non-200 or lacks a canonical tag", async () => {
    const acceptHeaders: string[] = [];

    // Both 200, both have canonical
    const ok = createMockFetch([
      [
        "/brands?category=",
        (_url: string, init?: RequestInit) => {
          const h = new Headers(init?.headers);
          acceptHeaders.push(h.get("Accept") ?? "");
          return {
            body: CATEGORY_PAGE_WITH_CANONICAL,
            status: 200,
          };
        },
      ],
    ]);
    const passResults = await assertCategory(ctx(ok.fetch));
    expect(passResults.every((r) => r.ok)).toBe(true);
    // Both Accept headers must have been tried
    expect(acceptHeaders.length).toBeGreaterThanOrEqual(2);
    expect(acceptHeaders).toContain("text/html");
    expect(acceptHeaders).toContain("*/*");

    // One returns 500
    const oneDown = createMockFetch([
      [
        "/brands?category=",
        (_url: string, init?: RequestInit) => {
          const h = new Headers(init?.headers);
          if (h.get("Accept") === "*/*") {
            return { body: "error", status: 500 };
          }
          return { body: CATEGORY_PAGE_WITH_CANONICAL, status: 200 };
        },
      ],
    ]);
    const failStatus = await assertCategory(ctx(oneDown.fetch));
    expect(failStatus.some((r) => !r.ok)).toBe(true);

    // Both 200 but missing canonical
    const noCanonical = createMockFetch([
      [
        "/brands?category=",
        {
          body: "<html><head><title>Home</title></head><body>No canonical</body></html>",
          status: 200,
        },
      ],
    ]);
    const failCanonical = await assertCategory(ctx(noCanonical.fetch));
    expect(failCanonical.some((r) => !r.ok)).toBe(true);
  });
});

describe("assertBrandPage", () => {
  it("brand page assertion requires a JSON-LD block and a purchase link", async () => {
    // Missing JSON-LD
    const noJsonLd = createMockFetch([
      [
        "/brands/test-brand",
        {
          body: '<html><body><a href="https://shop.example.com/buy">Buy</a></body></html>',
          status: 200,
        },
      ],
    ]);
    const failJsonLd = await assertBrandPage(
      ctx(noJsonLd.fetch),
      "https://example.com/brands/test-brand",
    );
    expect(failJsonLd.some((r) => !r.ok)).toBe(true);

    // Missing purchase link
    const noLink = createMockFetch([
      [
        "/brands/test-brand",
        {
          body: '<html><head><script type="application/ld+json">{"@type":"LocalBusiness"}</script></head><body>No link</body></html>',
          status: 200,
        },
      ],
    ]);
    const failLink = await assertBrandPage(
      ctx(noLink.fetch),
      "https://example.com/brands/test-brand",
    );
    expect(failLink.some((r) => !r.ok)).toBe(true);

    // Both present
    const ok = createMockFetch([
      ["/brands/test-brand", { body: HEALTHY_BRAND_PAGE, status: 200 }],
    ]);
    const passResults = await assertBrandPage(
      ctx(ok.fetch),
      "https://example.com/brands/test-brand",
    );
    expect(passResults.every((r) => r.ok)).toBe(true);
  });
});

describe("assertOriginGuard", () => {
  it("origin guard assertion fails when /api/health reports the guard off", async () => {
    const disabled = createMockFetch([
      [
        "/api/health",
        {
          body: JSON.stringify({
            originGuard: "disabled",
            rateLimitStore: "ok",
            status: "ok",
          }),
          status: 200,
        },
      ],
    ]);
    const failResults = await assertOriginGuard(ctx(disabled.fetch));
    expect(failResults.some((r) => !r.ok)).toBe(true);

    const enabled = createMockFetch([
      ["/api/health", { body: HEALTHY_HEALTH_BODY, status: 200 }],
    ]);
    const passResults = await assertOriginGuard(ctx(enabled.fetch));
    expect(passResults.every((r) => r.ok)).toBe(true);
  });
});

describe("browser user agent", () => {
  it("every assertion sends the browser user agent", async () => {
    const { fetch: mockFetchFn, calls } = createMockFetch([
      ["/sitemap.xml", { body: sitemap(BRAND_URL_FLOOR + 1), status: 200 }],
      [
        "/robots.txt",
        { body: "User-agent: *\nAllow: /\n", status: 200 },
      ],
      [
        "/en/brands",
        {
          body: '<html lang="en"><body>Brands</body></html>',
          status: 200,
        },
      ],
      ["/brands?category=", { body: CATEGORY_PAGE_WITH_CANONICAL, status: 200 }],
      ["/api/health", { body: HEALTHY_HEALTH_BODY, status: 200 }],
    ]);

    await runRepeatSafeAssertions(ctx(mockFetchFn));

    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.headers.get("User-Agent")).toBe(BROWSER_USER_AGENT);
    }
  });
});

describe("runRepeatSafeAssertions", () => {
  it("repeatSafe subset excludes brand detail pages", async () => {
    const { fetch: mockFetchFn, calls } = createMockFetch([
      ["/sitemap.xml", { body: sitemap(BRAND_URL_FLOOR + 1), status: 200 }],
      [
        "/robots.txt",
        { body: "User-agent: *\nAllow: /\n", status: 200 },
      ],
      [
        "/en/brands",
        {
          body: '<html lang="en"><body>Brands</body></html>',
          status: 200,
        },
      ],
      ["/brands?category=", { body: CATEGORY_PAGE_WITH_CANONICAL, status: 200 }],
      ["/api/health", { body: HEALTHY_HEALTH_BODY, status: 200 }],
    ]);

    const results = await runRepeatSafeAssertions(ctx(mockFetchFn));

    // No brand detail pages should have been fetched
    const brandDetailCalls = calls.filter(
      (c) => /\/brands\/[a-z]/.test(c.url),
    );
    expect(brandDetailCalls).toHaveLength(0);

    // Assertions should include sitemap, robots, locale, category, origin guard
    const names = results.map((r) => r.name);
    expect(names).not.toContain("og-image");
    expect(names).not.toContain("brand-page");
    // Must include the repeat-safe checks
    expect(names).toContain("sitemap");
    expect(names).toContain("robots");
    expect(names).toContain("english-locale");
    expect(names).toContain("origin-guard");
    // Category produces results for each Accept header
    expect(names.some((n) => n.startsWith("category"))).toBe(true);
  });
});
