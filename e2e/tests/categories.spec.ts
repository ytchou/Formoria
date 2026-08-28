import { expect, test } from "@playwright/test";
import { load } from "cheerio";

const CANONICAL_ORIGIN = new URL(
  process.env.STAGING_BASE_URL ?? "https://staging.formoria.com",
).origin;

function metadataFrom(html: string) {
  const $ = load(html);
  return {
    title: $("title").text(),
    description: $('meta[name="description"]').attr("content"),
    h1: $("main h1").first().text().trim(),
  };
}

test.describe("Product catalog (formerly category landings) deep", () => {
  test("@smoke product catalog returns metadata and a heading", async ({
    request,
  }) => {
    for (const path of ["/discover", "/discover?category=home"]) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(200);
      const metadata = metadataFrom(await response.text());
      expect(metadata.title, `${path} title`).toBeTruthy();
      expect(metadata.description, `${path} description`).toBeTruthy();
      expect(metadata.h1, `${path} h1`).toBeTruthy();
    }
  });

  test("@smoke product catalog advertises reciprocal localized canonicals", async ({
    page,
  }) => {
    for (const route of ["/discover", "/discover?category=home"]) {
      for (const localePrefix of ["", "/en"]) {
        const fullRoute = `${localePrefix}${route}`;
        await page.goto(fullRoute);

        // The canonical includes the locale prefix (empty for zh-TW).
        await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
          "href",
          new RegExp(`^${CANONICAL_ORIGIN}`),
        );
        await expect(
          page.locator('link[rel="alternate"][hreflang="zh-TW"]'),
        ).toHaveAttribute("href", new RegExp(`^${CANONICAL_ORIGIN}/discover`));
        await expect(
          page.locator('link[rel="alternate"][hreflang="en"]'),
        ).toHaveAttribute(
          "href",
          new RegExp(`^${CANONICAL_ORIGIN}/en/discover`),
        );
      }
    }
  });

  test("product catalog renders a category filter sidebar", async ({
    page,
  }) => {
    await page.goto("/discover");

    const sidebar = page.locator("aside");
    await expect(sidebar).toBeVisible();

    // The sidebar contains category filter links.
    const categoryLinks = sidebar.getByRole("link");
    const count = await categoryLinks.count();
    // At minimum: "all" + at least one L1 category.
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test("product catalog with category filter shows products or empty state", async ({
    page,
  }) => {
    await page.goto("/discover?category=home");

    // Either product cards or empty state must be visible.
    const products = page.locator("main").getByRole("listitem").first();
    const emptyState = page.locator("[data-empty]").first();
    await expect(products.or(emptyState)).toBeVisible();
  });

  test("bare and multi-category directories omit taxonomy-only landing facts", async ({
    page,
  }) => {
    for (const path of ["/brands", "/brands?category=home,fashion"]) {
      await page.goto(path);
      await expect(
        page.getByRole("navigation", { name: "麵包屑導覽" }),
      ).toHaveCount(0);
      await expect(page.getByText(/更新於 \d{4}年/)).toHaveCount(0);
    }
  });

  test("page 2 remains self-canonical on the product catalog", async ({
    page,
  }) => {
    await page.goto("/discover?category=home&page=2");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      new RegExp(
        `^${CANONICAL_ORIGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/discover`,
      ),
    );
  });

  test("product catalog search and out-of-range pages show empty state", async ({
    page,
  }) => {
    await page.goto(
      "/discover?category=home&page=999",
    );
    // Out-of-range page: either shows empty state or redirects to valid page.
    const emptyState = page.locator("[data-empty]");
    const products = page.locator("main").getByRole("listitem").first();
    await expect(emptyState.or(products)).toBeVisible();
  });

  test("/categories/* redirects to /discover with correct query params", async ({
    request,
  }) => {
    const redirects = [
      ["/categories/home", "/discover?category=home"],
      ["/categories/home/furniture", "/discover?category=home&sub=furniture"],
      ["/categories/food-drink", "/discover?category=food-drink"],
    ] as const;

    for (const [source, expectedDestination] of redirects) {
      const response = await request.get(source, { maxRedirects: 0 });
      expect(response.status(), `${source} status`).toBe(301);
      const location = response.headers().location;
      expect(location, `${source} location`).toBeTruthy();
      // The catch-all route handler builds an absolute URL; compare the
      // path + query portion.
      const locationUrl = new URL(location!, "http://localhost");
      const expectedUrl = new URL(expectedDestination, "http://localhost");
      expect(locationUrl.pathname, `${source} pathname`).toBe(
        expectedUrl.pathname,
      );
      expect(locationUrl.searchParams.get("category"), `${source} category`).toBe(
        expectedUrl.searchParams.get("category"),
      );
      expect(
        locationUrl.searchParams.get("sub"),
        `${source} sub`,
      ).toBe(expectedUrl.searchParams.get("sub"));
    }
  });
});
