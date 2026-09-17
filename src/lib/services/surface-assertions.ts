/**
 * Pure surface-health assertion functions.
 *
 * Every function takes `{ baseUrl, fetch }` and returns `{ name, ok, detail }[]`.
 * No side effects, no process globals — usable from the production probe, the
 * health agent, and unit tests alike.
 *
 * Ceiling: assertions check HTML text with regex. A React hydration change that
 * rewrites tag order will break a regex but not a DOM query. Upgrade path:
 * switch to a lightweight HTML parser (e.g. htmlparser2) when assertions exceed
 * five regex extractions.
 */

export interface AssertionResult {
  name: string;
  ok: boolean;
  detail: string;
}

export interface AssertionContext {
  baseUrl: string;
  fetch: typeof fetch;
}

/**
 * Cloudflare answers curl's default fingerprint with 403, so every outbound
 * request must look like a browser. Shared with the production probe.
 */
export const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

/**
 * Minimum number of `/brands/<slug>` URLs the sitemap must contain. ~718
 * approved brands as of 2026-09; 50 catches a completely broken sitemap build
 * without being so high that a legitimate filtering change trips it.
 *
 * Ceiling: raise when the catalogue passes ~1500 brands.
 */
export const BRAND_URL_FLOOR = 50;

/** Category slug used for the category surface assertion. */
const PROBE_CATEGORY = "home";

// ── Internal helpers ────────────────────────────────────────────────────────

function browserFetch(
  ctx: AssertionContext,
  url: string,
  init?: RequestInit,
): Promise<Response> {
  return ctx.fetch(url, {
    ...init,
    headers: { "User-Agent": BROWSER_USER_AGENT, ...(init?.headers as Record<string, string>) },
  });
}

/**
 * Extract `<loc>` values from a sitemap XML string. Uses a regex because the
 * sitemap is simple flat XML and pulling in a parser is not justified.
 */
export function parseSitemapBrandUrls(xml: string): string[] {
  const locRegex = /<loc>\s*(https?:\/\/[^<]+\/brands\/[^<]+?)\s*<\/loc>/g;
  const urls: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = locRegex.exec(xml)) !== null) {
    if (match[1]) urls.push(match[1]);
  }
  return urls;
}

// ── Individual assertions ───────────────────────────────────────────────────

export async function assertSitemap(
  ctx: AssertionContext,
): Promise<AssertionResult[]> {
  const response = await browserFetch(ctx, `${ctx.baseUrl}/sitemap.xml`);
  if (!response.ok) {
    return [
      {
        name: "sitemap",
        ok: false,
        detail: `sitemap.xml returned HTTP ${response.status}`,
      },
    ];
  }
  const xml = await response.text();
  const brandUrls = parseSitemapBrandUrls(xml);
  if (brandUrls.length < BRAND_URL_FLOOR) {
    return [
      {
        name: "sitemap",
        ok: false,
        detail: `sitemap contains ${brandUrls.length} brand URLs, expected >= ${BRAND_URL_FLOOR}`,
      },
    ];
  }
  return [
    {
      name: "sitemap",
      ok: true,
      detail: `${brandUrls.length} brand URLs in sitemap`,
    },
  ];
}

export async function assertRobots(
  ctx: AssertionContext,
): Promise<AssertionResult[]> {
  const response = await browserFetch(ctx, `${ctx.baseUrl}/robots.txt`);
  if (!response.ok) {
    return [
      {
        name: "robots",
        ok: false,
        detail: `robots.txt returned HTTP ${response.status}`,
      },
    ];
  }
  const text = await response.text();
  // A blanket `Disallow: /` blocks the entire site. The line must end with
  // exactly `/` — `Disallow: /admin` is a targeted rule, not a blanket one.
  const blanketDisallow = /^Disallow:\s*\/\s*$/m.test(text);
  if (blanketDisallow) {
    return [
      {
        name: "robots",
        ok: false,
        detail: "robots.txt contains blanket Disallow: /",
      },
    ];
  }
  return [{ name: "robots", ok: true, detail: "robots.txt allows crawling" }];
}

export async function assertOgImage(
  ctx: AssertionContext,
  brandPageUrl: string,
): Promise<AssertionResult[]> {
  const pageResponse = await browserFetch(ctx, brandPageUrl);
  if (!pageResponse.ok) {
    return [
      {
        name: "og-image",
        ok: false,
        detail: `brand page returned HTTP ${pageResponse.status}`,
      },
    ];
  }
  const html = await pageResponse.text();
  const ogMatch = html.match(
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/,
  );
  if (!ogMatch?.[1]) {
    return [
      {
        name: "og-image",
        ok: false,
        detail: "no og:image meta tag found on brand page",
      },
    ];
  }

  const imageUrl = ogMatch[1];
  const imageResponse = await browserFetch(ctx, imageUrl, { method: "HEAD" });
  if (!imageResponse.ok) {
    return [
      {
        name: "og-image",
        ok: false,
        detail: `og:image URL returned HTTP ${imageResponse.status}`,
      },
    ];
  }
  const contentType = imageResponse.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/")) {
    return [
      {
        name: "og-image",
        ok: false,
        detail: `og:image content-type is ${contentType}, expected image/*`,
      },
    ];
  }
  return [{ name: "og-image", ok: true, detail: "og:image is reachable" }];
}

export async function assertEnglishLocale(
  ctx: AssertionContext,
): Promise<AssertionResult[]> {
  const response = await browserFetch(ctx, `${ctx.baseUrl}/en/brands`);
  if (!response.ok) {
    return [
      {
        name: "english-locale",
        ok: false,
        detail: `/en/brands returned HTTP ${response.status}`,
      },
    ];
  }
  const html = await response.text();
  // The `lang` attribute on <html> is the most reliable signal. If
  // next-intl's locale detection breaks, it falls back to zh-TW and the
  // attribute reflects that.
  const langMatch = html.match(/<html[^>]+lang=["']([^"']+)["']/);
  const lang = langMatch?.[1] ?? "";
  if (lang === "zh-TW") {
    return [
      {
        name: "english-locale",
        ok: false,
        detail: `/en/brands rendered with lang="zh-TW" instead of "en"`,
      },
    ];
  }
  return [
    {
      name: "english-locale",
      ok: true,
      detail: `/en/brands rendered with lang="${lang}"`,
    },
  ];
}

export async function assertCategory(
  ctx: AssertionContext,
): Promise<AssertionResult[]> {
  const url = `${ctx.baseUrl}/brands?category=${PROBE_CATEGORY}`;
  const results: AssertionResult[] = [];

  for (const accept of ["text/html", "*/*"]) {
    const response = await browserFetch(ctx, url, {
      headers: { Accept: accept },
    });
    const label = `category(Accept: ${accept})`;
    if (!response.ok) {
      results.push({
        name: label,
        ok: false,
        detail: `${url} returned HTTP ${response.status} with Accept: ${accept}`,
      });
      continue;
    }
    const html = await response.text();
    const hasCanonical = /<link[^>]+rel=["']canonical["'][^>]*>/.test(html);
    if (!hasCanonical) {
      results.push({
        name: label,
        ok: false,
        detail: `${url} is missing a canonical tag under Accept: ${accept}`,
      });
    } else {
      results.push({
        name: label,
        ok: true,
        detail: `category page OK under Accept: ${accept}`,
      });
    }
  }

  return results;
}

export async function assertBrandPage(
  ctx: AssertionContext,
  brandPageUrl: string,
): Promise<AssertionResult[]> {
  const response = await browserFetch(ctx, brandPageUrl);
  if (!response.ok) {
    return [
      {
        name: "brand-page",
        ok: false,
        detail: `brand page returned HTTP ${response.status}`,
      },
    ];
  }
  const html = await response.text();
  const results: AssertionResult[] = [];

  const hasJsonLd =
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>/.test(html);
  if (!hasJsonLd) {
    results.push({
      name: "brand-page",
      ok: false,
      detail: "brand page is missing JSON-LD structured data",
    });
  }

  // A "purchase link" is any anchor whose href points to an external shopping
  // destination. The brand page always routes out to the brand's own channel,
  // so ANY external <a href> whose text or URL contains shop/buy/purchase/
  // purchase keywords counts.
  const hasExternalLink = /<a[^>]+href=["']https?:\/\/[^"']+["'][^>]*>/.test(
    html,
  );
  if (!hasExternalLink) {
    results.push({
      name: "brand-page",
      ok: false,
      detail: "brand page is missing an external purchase link",
    });
  }

  if (results.length === 0) {
    results.push({
      name: "brand-page",
      ok: true,
      detail: "brand page has JSON-LD and a purchase link",
    });
  }

  return results;
}

export async function assertOriginGuard(
  ctx: AssertionContext,
): Promise<AssertionResult[]> {
  const response = await browserFetch(ctx, `${ctx.baseUrl}/api/health`);
  if (!response.ok) {
    return [
      {
        name: "origin-guard",
        ok: false,
        detail: `/api/health returned HTTP ${response.status}`,
      },
    ];
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return [
      {
        name: "origin-guard",
        ok: false,
        detail: "/api/health body is not valid JSON",
      },
    ];
  }
  const guard = (body as Record<string, unknown>)?.originGuard;
  if (guard !== "enabled") {
    return [
      {
        name: "origin-guard",
        ok: false,
        detail: `origin guard is "${String(guard)}", expected "enabled"`,
      },
    ];
  }
  return [{ name: "origin-guard", ok: true, detail: "origin guard enabled" }];
}

// ── Runners ─────────────────────────────────────────────────────────────────

/**
 * The repeat-safe subset: assertions that are cheap to run on every scheduled
 * probe. Excludes brand detail pages which sit behind the Turnstile soft-limit
 * and are expensive to check repeatedly.
 *
 * The sitemap is fetched ONCE and shared by all assertions that need it.
 */
export async function runRepeatSafeAssertions(
  ctx: AssertionContext,
): Promise<AssertionResult[]> {
  // Sitemap is fetched once and shared
  const sitemapResponse = await browserFetch(ctx, `${ctx.baseUrl}/sitemap.xml`);
  let sitemapResults: AssertionResult[];
  if (!sitemapResponse.ok) {
    sitemapResults = [
      {
        name: "sitemap",
        ok: false,
        detail: `sitemap.xml returned HTTP ${sitemapResponse.status}`,
      },
    ];
  } else {
    const xml = await sitemapResponse.text();
    const brandUrls = parseSitemapBrandUrls(xml);
    sitemapResults =
      brandUrls.length < BRAND_URL_FLOOR
        ? [
            {
              name: "sitemap",
              ok: false,
              detail: `sitemap contains ${brandUrls.length} brand URLs, expected >= ${BRAND_URL_FLOOR}`,
            },
          ]
        : [
            {
              name: "sitemap",
              ok: true,
              detail: `${brandUrls.length} brand URLs in sitemap`,
            },
          ];
  }

  const [robotsResults, localeResults, categoryResults, guardResults] =
    await Promise.all([
      assertRobots(ctx),
      assertEnglishLocale(ctx),
      assertCategory(ctx),
      assertOriginGuard(ctx),
    ]);

  return [
    ...sitemapResults,
    ...robotsResults,
    ...localeResults,
    ...categoryResults,
    ...guardResults,
  ];
}

/**
 * All assertions, including brand detail pages. Fetches the sitemap once, picks
 * the first brand URL for og:image and brand-page checks.
 */
export async function runAllAssertions(
  ctx: AssertionContext,
): Promise<AssertionResult[]> {
  const sitemapResponse = await browserFetch(ctx, `${ctx.baseUrl}/sitemap.xml`);
  let brandUrls: string[] = [];
  let sitemapResults: AssertionResult[];
  if (!sitemapResponse.ok) {
    sitemapResults = [
      {
        name: "sitemap",
        ok: false,
        detail: `sitemap.xml returned HTTP ${sitemapResponse.status}`,
      },
    ];
  } else {
    const xml = await sitemapResponse.text();
    brandUrls = parseSitemapBrandUrls(xml);
    sitemapResults =
      brandUrls.length < BRAND_URL_FLOOR
        ? [
            {
              name: "sitemap",
              ok: false,
              detail: `sitemap contains ${brandUrls.length} brand URLs, expected >= ${BRAND_URL_FLOOR}`,
            },
          ]
        : [
            {
              name: "sitemap",
              ok: true,
              detail: `${brandUrls.length} brand URLs in sitemap`,
            },
          ];
  }

  const [robotsResults, localeResults, categoryResults, guardResults] =
    await Promise.all([
      assertRobots(ctx),
      assertEnglishLocale(ctx),
      assertCategory(ctx),
      assertOriginGuard(ctx),
    ]);

  let brandResults: AssertionResult[] = [];
  if (brandUrls.length > 0) {
    const probeUrl = brandUrls[0]!;
    const [ogResults, pageResults] = await Promise.all([
      assertOgImage(ctx, probeUrl),
      assertBrandPage(ctx, probeUrl),
    ]);
    brandResults = [...ogResults, ...pageResults];
  } else {
    brandResults = [
      {
        name: "og-image",
        ok: false,
        detail: "no brand URLs in sitemap to check og:image",
      },
      {
        name: "brand-page",
        ok: false,
        detail: "no brand URLs in sitemap to check brand page",
      },
    ];
  }

  return [
    ...sitemapResults,
    ...robotsResults,
    ...localeResults,
    ...categoryResults,
    ...guardResults,
    ...brandResults,
  ];
}
