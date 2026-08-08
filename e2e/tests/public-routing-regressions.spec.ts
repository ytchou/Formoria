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
      ["/categories/baby-kids", "/categories/kids-pets"],
      ["/categories/pets", "/categories/kids-pets"],
      ["/categories/food", "/categories/food-drink"],
      ["/categories/beverages", "/categories/food-drink"],
      ["/en/categories/clothing", "/en/categories/fashion"],
      ["/categories/others", "/brands"],
      ["/about-us", "/about"],
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
