import { test, expect } from "@playwright/test";

test.describe("Public routing regressions deep", () => {
  test("@smoke legacy category query URLs redirect once to their landing page", async ({
    request,
  }) => {
    const redirects = [
      ["/brands?category=home", "/categories/home"],
      ["/brands?category=home&sub=furniture", "/categories/home/furniture"],
    ] as const;

    for (const [source, destination] of redirects) {
      const response = await request.get(source, { maxRedirects: 0 });
      expect(response.status()).toBe(301);
      expect(response.headers().location).toBe(destination);

      const destinationResponse = await request.get(destination, {
        maxRedirects: 0,
      });
      expect(destinationResponse.status()).toBe(200);
      expect(destinationResponse.headers().location).toBeUndefined();
    }
  });

  test("legacy locale category aliases target the new localized route family", async ({
    request,
  }) => {
    const redirects = [
      ["/en/category/food-drink", 301, "/en/categories/food-drink"],
      ["/zh-TW/category/home", 301, "/categories/home"],
    ] as const;

    for (const [source, status, destination] of redirects) {
      const response = await request.get(source, { maxRedirects: 0 });
      expect(response.status()).toBe(status);
      expect(response.headers().location).toBe(destination);
    }
  });

  test("the explicit default-locale category index normalizes in one hop", async ({
    request,
  }) => {
    const response = await request.get("/zh-TW/categories", {
      maxRedirects: 0,
    });
    expect([307, 308]).toContain(response.status());
    expect(response.headers().location).toBe("/categories");

    const destination = await request.get("/categories", { maxRedirects: 0 });
    expect(destination.status()).toBe(200);
    expect(destination.headers().location).toBeUndefined();
  });

  test("retired L1 taxonomy slugs redirect to the category that absorbed them", async ({
    request,
  }) => {
    // These 404'd in production for long enough that Search Console reported
    // every one of them. The destination assertion is the point: redirecting a
    // dead category onto another dead alias just moves the 404 one hop out.
    const redirects = [
      ["/categories/accessories", "/categories/bags-accessories"],
      ["/categories/bags", "/categories/bags-accessories"],
      // DEV-1599 deferred both split parents from public surfaces, so legacy
      // kids traffic lands on the directory without a second redirect hop.
      ["/categories/baby-kids", "/brands"],
      ["/categories/kids-pets", "/brands"],
      // DEV-1507 dissolved crafts across four live L1s, so like kids-pets it
      // has no successor category and exits to the directory root.
      ["/categories/crafts", "/brands"],
      ["/categories/food", "/categories/food-drink"],
      ["/categories/beverages", "/categories/food-drink"],
      ["/en/categories/clothing", "/en/categories/fashion"],
      ["/categories/others", "/brands"],
      ["/about-us", "/about"],
      // DEV-1531: the L1 rows above rescue /categories/crafts and
      // /categories/kids-pets, but a Next `source` is a literal path, so every
      // L2 URL beneath them still 404s. These 29 were indexed before the
      // taxonomy transform retired them. Generated into next.config.ts by
      // `pnpm exec tsx scripts/generate-category-redirects.ts --write`.
      //
      // The ten crafts L2s with no successor exit to the directory root.
      ["/categories/crafts/ceramics", "/brands"],
      ["/categories/crafts/woodcraft", "/brands"],
      ["/categories/crafts/metalwork", "/brands"],
      ["/categories/crafts/bamboo-craft", "/brands"],
      ["/categories/crafts/glass-art", "/brands"],
      ["/categories/crafts/natural-dyeing", "/brands"],
      ["/categories/crafts/leather-craft", "/brands"],
      ["/categories/crafts/embroidery", "/brands"],
      ["/categories/crafts/needle-felting", "/brands"],
      ["/categories/crafts/weaving-and-crochet", "/brands"],
      // Two crafts L2s were relocated rather than dissolved.
      ["/categories/crafts/illustration-and-art", "/categories/home/wall-art"],
      [
        "/categories/crafts/dried-flowers-and-floral-design",
        "/categories/home/floral-arrangements",
      ],
      // The kids-pets split kept every slug, but both new parents are deferred;
      // each legacy URL therefore lands directly on the public directory.
      ["/categories/kids-pets/kids-clothing", "/brands"],
      ["/categories/kids-pets/family-matching", "/brands"],
      ["/categories/kids-pets/baby-clothing", "/brands"],
      ["/categories/kids-pets/baby-bedding", "/brands"],
      ["/categories/kids-pets/bibs-and-muslin", "/brands"],
      ["/categories/kids-pets/kids-tableware", "/brands"],
      ["/categories/kids-pets/toys", "/brands"],
      ["/categories/kids-pets/learning-aids", "/brands"],
      ["/categories/kids-pets/play-mats-and-fences", "/brands"],
      ["/categories/kids-pets/parenting-essentials", "/brands"],
      ["/categories/kids-pets/pet-food", "/brands"],
      ["/categories/kids-pets/pet-treats", "/brands"],
      ["/categories/kids-pets/pet-supplements", "/brands"],
      ["/categories/kids-pets/pet-apparel", "/brands"],
      ["/categories/kids-pets/pet-beds-and-scratchers", "/brands"],
      ["/categories/kids-pets/pet-grooming", "/brands"],
      ["/categories/kids-pets/pet-supplies", "/brands"],
    ] as const;

    // Issued concurrently, and destinations deduped. The table grew to 39 rows
    // when the retired L2 URLs joined it (DEV-1531); serially that is 78 remote
    // round trips against deployed staging, which overran the test budget and
    // tore the request context down mid-flight rather than failing an
    // assertion. Ten of the rows share `/brands` as their destination, so the
    // distinct-destination set is far smaller than the row count.
    const sourceResults = await Promise.all(
      redirects.map(async ([source, destination]) => ({
        source,
        destination,
        response: await request.get(source, { maxRedirects: 0 }),
      })),
    );
    for (const { source, destination, response } of sourceResults) {
      expect(response.status(), `${source} should redirect`).toBe(308);
      expect(response.headers().location, `${source} target`).toBe(destination);
    }

    const destinations = [...new Set(redirects.map(([, to]) => to))];
    const destinationResults = await Promise.all(
      destinations.map(async (destination) => ({
        destination,
        response: await request.get(destination, { maxRedirects: 0 }),
      })),
    );
    for (const { destination, response } of destinationResults) {
      expect(response.status(), `${destination} should render`).toBe(200);
    }
  });

  test("@smoke default-locale auth aliases redirect once and preserve query parameters", async ({
    request,
  }) => {
    const source = "/zh-TW/auth/reset-password?next=%2Fbrands%2Fexample";
    const response = await request.get(source, { maxRedirects: 0 });
    expect(response.status()).toBe(308);

    const sourceUrl = new URL(source, "http://localhost");
    const location = new URL(response.headers().location, "http://localhost");
    expect(location.pathname).toBe(sourceUrl.pathname.replace(/^\/zh-TW/, ""));
    expect(location.searchParams.get("next")).toBe(
      sourceUrl.searchParams.get("next"),
    );
  });

  test("@smoke English auth URLs render in place instead of redirecting", async ({
    request,
  }) => {
    const response = await request.get(
      "/en/auth/sign-in?next=%2Fen%2Fcontributions",
      {
        maxRedirects: 0,
      },
    );
    expect(response.status()).toBe(200);
    expect(response.headers().location).toBeUndefined();
  });

  test("@smoke landing CSP allows the GA4 audience pixel host", async ({
    page,
  }) => {
    const response = await page.goto("/");
    const contentSecurityPolicy =
      response?.headers()["content-security-policy"] ?? "";
    expect(contentSecurityPolicy).toContain("img-src");
    expect(contentSecurityPolicy).toContain("https://www.google.com.tw");
  });
});
