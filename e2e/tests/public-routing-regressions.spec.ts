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
      ["/en/categories", 308, "/en/brands"],
      ["/zh-TW/categories", 308, "/brands"],
    ] as const;

    for (const [source, status, destination] of redirects) {
      const response = await request.get(source, { maxRedirects: 0 });
      expect(response.status()).toBe(status);
      expect(response.headers().location).toBe(destination);
    }
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
      // DEV-1510 split kids-pets into the live L1s kids and pets: baby-kids
      // now lands on kids, `pets` is a page rather than a redirect source, and
      // the merged parent has no successor category, so it exits to /brands.
      ["/categories/baby-kids", "/categories/kids"],
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
      // The kids-pets split kept every slug; only the parent changed.
      ["/categories/kids-pets/kids-clothing", "/categories/kids/kids-clothing"],
      [
        "/categories/kids-pets/family-matching",
        "/categories/kids/family-matching",
      ],
      ["/categories/kids-pets/baby-clothing", "/categories/kids/baby-clothing"],
      ["/categories/kids-pets/baby-bedding", "/categories/kids/baby-bedding"],
      [
        "/categories/kids-pets/bibs-and-muslin",
        "/categories/kids/bibs-and-muslin",
      ],
      [
        "/categories/kids-pets/kids-tableware",
        "/categories/kids/kids-tableware",
      ],
      ["/categories/kids-pets/toys", "/categories/kids/toys"],
      ["/categories/kids-pets/learning-aids", "/categories/kids/learning-aids"],
      [
        "/categories/kids-pets/play-mats-and-fences",
        "/categories/kids/play-mats-and-fences",
      ],
      [
        "/categories/kids-pets/parenting-essentials",
        "/categories/kids/parenting-essentials",
      ],
      ["/categories/kids-pets/pet-food", "/categories/pets/pet-food"],
      ["/categories/kids-pets/pet-treats", "/categories/pets/pet-treats"],
      [
        "/categories/kids-pets/pet-supplements",
        "/categories/pets/pet-supplements",
      ],
      ["/categories/kids-pets/pet-apparel", "/categories/pets/pet-apparel"],
      [
        "/categories/kids-pets/pet-beds-and-scratchers",
        "/categories/pets/pet-beds-and-scratchers",
      ],
      ["/categories/kids-pets/pet-grooming", "/categories/pets/pet-grooming"],
      ["/categories/kids-pets/pet-supplies", "/categories/pets/pet-supplies"],
    ] as const;

    for (const [source, destination] of redirects) {
      const response = await request.get(source, { maxRedirects: 0 });
      expect(response.status(), `${source} should redirect`).toBe(308);
      expect(response.headers().location, `${source} target`).toBe(destination);

      const destinationResponse = await request.get(destination, {
        maxRedirects: 0,
      });
      expect(destinationResponse.status(), `${destination} should render`).toBe(
        200,
      );
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
