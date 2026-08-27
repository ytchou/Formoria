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

  test("home and About pages server-render the approved identity in both locales", async ({
    page,
  }) => {
    const homeLocales = [
      {
        path: "/",
        title: "Formoria：台灣品牌探索與選物平台",
        description:
          "Formoria 把相遇之後的路接起來：從一件喜歡的東西，走到它的品牌、它的故事，和買得到它的地方。台灣品牌探索與選物平台，從生活出發認識產品與品牌。",
        heading: "生活可以更像自己一點。",
        positioning:
          "Formoria 是台灣品牌探索與選物平台，從生活出發認識產品與品牌。",
        manifestoHeading: "讓好東西，被更多人遇見。",
      },
      {
        path: "/en",
        title: "Formoria — Taiwanese Brand Discovery & Curation",
        // `landing.metadata.description` as DEV-1486 reconciled it. The literal
        // that stood here asserted no rendered value at all: it spliced
        // `about.hero.subtitle` onto a variant of `landing.subheadline`, so the
        // EN half of this test could never pass while the zh-TW half — which
        // does quote `landing.metadata.description` — always did. Nothing caught
        // it because the suite only runs against deployed staging (DEV-1489).
        description:
          "Taiwanese brand discovery and curation: from one thing you love, to its brand, its story, and the place you can buy it. Formoria reconnects that path.",
        heading: "Life can look a little more like you.",
        positioning:
          "Formoria is a Taiwanese brand discovery and curation platform — start from life, meet the products and the brands.",
        manifestoHeading: "Helping good things find more people.",
      },
    ] as const;
    const aboutLocales = [
      {
        path: "/about",
        title: "關於 Formoria | Formoria",
        description:
          "為什麼會有 Formoria：四條斷掉的路，和我們把它們接起來的方式。從一件喜歡的東西，走到它的品牌、它的故事，和買得到它的地方。",
        heading: "搬新家、佈置店面、\n在市集停下來的那一刻",
      },
      {
        path: "/en/about",
        title: "About Formoria | Formoria",
        description:
          "Why Formoria exists: four broken paths, and how we connect them. From one thing you love, to its brand, its story, and the place you can buy it.",
        heading:
          "Moving into a new home, setting up a shop, stopping at a market stall",
      },
    ] as const;

    for (const locale of homeLocales) {
      await page.goto(locale.path);
      await expect(page).toHaveTitle(locale.title);
      await expect(page.locator('meta[name="description"]')).toHaveAttribute(
        "content",
        locale.description,
      );
      await expect(
        page.locator('meta[property="og:description"]'),
      ).toHaveAttribute("content", locale.description);
      await expect(
        page.getByRole("heading", { level: 1, name: locale.heading }),
      ).toBeVisible({ timeout: BUDGET.SERVER_RENDER });
      await expect(
        page.getByText(locale.positioning, { exact: true }),
      ).toBeVisible();
      // The trust line "收錄與選物，清楚分開" left the homepage on 2026-08-17
      // when the manifesto band replaced the trust seam. It ships on /faq and
      // the /og/trust card. What the homepage states here now is the positioning
      // line.
      await expect(
        page.getByRole("heading", { name: locale.manifestoHeading, level: 2 }),
      ).toBeVisible();
    }

    for (const locale of aboutLocales) {
      await page.goto(locale.path);
      await expect(page).toHaveTitle(locale.title);
      await expect(page.locator('meta[name="description"]')).toHaveAttribute(
        "content",
        locale.description,
      );
      await expect(
        page.locator('meta[property="og:description"]'),
      ).toHaveAttribute("content", locale.description);
      await expect(
        page.getByRole("heading", { level: 1, name: locale.heading }),
      ).toBeVisible({ timeout: BUDGET.SERVER_RENDER });
    }
  });

  test("sitemap.xml is accessible", async ({ request }) => {
    test.skip(
      process.env.FORMORIA_DEPLOYMENT_ENV === "staging",
      "Staging intentionally omits the sitemap.",
    );
    const response = await request.get("/sitemap.xml");
    expect(response.status()).toBe(200);
    const body = await response.text();
    expect(body).toContain("<urlset");
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
  //
  // Owned HERE, not by `alternates.test.ts`: that unit test calls
  // buildAlternates('/brands', 'en') and asserts the returned string. It never
  // renders the page, so a generateMetadata regression that drops the
  // `alternates` spread stays invisible to it while these fail.

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

  test("/about emits hreflang alternate links for zh-TW, en, and x-default", async ({
    page,
  }) => {
    await page.goto("/about");
    const canonical = await page
      .locator('link[rel="canonical"]')
      .getAttribute("href");
    const zhAlternate = await page
      .locator('link[rel="alternate"][hreflang="zh-TW"]')
      .getAttribute("href");
    const enAlternate = await page
      .locator('link[rel="alternate"][hreflang="en"]')
      .getAttribute("href");
    const xDefault = await page
      .locator('link[rel="alternate"][hreflang="x-default"]')
      .getAttribute("href");

    expect(canonical).toBeTruthy();
    expect(zhAlternate).toBeTruthy();
    expect(enAlternate).toBeTruthy();
    expect(xDefault).toBeTruthy();

    expect(canonical).not.toContain("/en/");
    expect(zhAlternate).not.toContain("/en/");
    expect(enAlternate).toContain("/en/");
    expect(xDefault).not.toContain("/en/");
  });

  test("/en/about emits hreflang alternate links", async ({ page }) => {
    await page.goto("/en/about");
    const canonical = await page
      .locator('link[rel="canonical"]')
      .getAttribute("href");
    const zhAlternate = await page
      .locator('link[rel="alternate"][hreflang="zh-TW"]')
      .getAttribute("href");
    const enAlternate = await page
      .locator('link[rel="alternate"][hreflang="en"]')
      .getAttribute("href");
    const xDefault = await page
      .locator('link[rel="alternate"][hreflang="x-default"]')
      .getAttribute("href");

    expect(canonical).toBeTruthy();
    expect(zhAlternate).toBeTruthy();
    expect(enAlternate).toBeTruthy();
    expect(xDefault).toBeTruthy();

    expect(canonical).toContain("/en/");
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

  test("sitemap includes the public editorial pages", async ({ request }) => {
    test.skip(
      process.env.FORMORIA_DEPLOYMENT_ENV === "staging",
      "Staging intentionally omits the sitemap.",
    );
    const body = await (await request.get("/sitemap.xml")).text();
    expect(body).toContain("/about");
    expect(body).not.toContain("/vision");
  });

  test("sitemap static pages expose a resolvable PNG OG image", async ({
    request,
  }) => {
    test.skip(
      process.env.FORMORIA_DEPLOYMENT_ENV === "staging",
      "Staging intentionally omits the sitemap.",
    );
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
      "/categories",
      // Not a member of sitemap.ts's `staticPages`: the trail hub is listed
      // zh-TW only and only while at least one trail is published, matching its
      // own `noindex` gate. Named here so the entry is still swept for a
      // resolvable OG image on the runs where the sitemap does emit it; on a
      // run with no published trail the filter below simply finds no match.
      "/discover",
      "/about",
      "/faq",
      "/contact",
      "/terms",
      "/privacy",
      "/submit",
    ]);
    const staticLocations = locations.filter((url) => {
      const path =
        url.pathname === "/en" ? "/" : url.pathname.replace(/^\/en(?=\/)/, "");
      return staticPaths.has(path) || path.startsWith("/categories/");
    });
    expect(staticLocations.length).toBeGreaterThan(0);
    expect(locations.some((url) => url.pathname === "/categories")).toBe(true);
    expect(locations.some((url) => url.pathname === "/en/categories")).toBe(
      true,
    );
    // A browser render per URL exceeds the CI timeout, while compiling every
    // route concurrently can overload a cold dev server and corrupt its route
    // manifests. Plain HTTP requests in small batches keep all URL assertions
    // while bounding lazy compilation pressure.
    const batchSize = 4;
    const renderedPages: Array<{ url: URL; path: string; html: string }> = [];
    for (let index = 0; index < staticLocations.length; index += batchSize) {
      const batch = staticLocations.slice(index, index + batchSize);
      const renderedBatch = await Promise.all(
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
          return { url, path, html };
        }),
      );
      renderedPages.push(...renderedBatch);
    }

    const categoryPages = renderedPages.filter(({ url }) =>
      url.pathname.replace(/^\/en(?=\/)/, "").startsWith("/categories/"),
    );
    for (const { path, html } of categoryPages) {
      expect(
        extractMetaContent(html, "twitter:card"),
        `${path} → twitter:card`,
      ).toBe("summary_large_image");
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

  // The only POSITIVE proof that the directory publishes structured data.
  // `directory-material.spec.ts` asserts an ItemList block is ABSENT for an
  // unknown material, which goes MORE green if ItemList disappears entirely.
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
    const parsed = JSON.parse(itemListBlock!) as {
      itemListElement?: Array<{
        position?: unknown;
        name?: unknown;
        url?: unknown;
      }>;
    };
    expect(Array.isArray(parsed.itemListElement)).toBe(true);
    const items = parsed.itemListElement ?? [];
    expect(
      items.every(
        (item) =>
          typeof item.position === "number" &&
          typeof item.name === "string" &&
          String(item.url).includes("/brands/"),
      ),
    ).toBe(true);
  });
});
