import { expect, test } from "@playwright/test";
import { load } from "cheerio";

const ORIGIN = "https://formoria.com";

function metadataFrom(html: string) {
  const $ = load(html);
  return {
    title: $("title").text(),
    description: $('meta[name="description"]').attr("content"),
    h1: $("main h1").first().text().trim(),
  };
}

test.describe("Category landing pages deep", () => {
  test("@smoke L1 and L2 landings return distinct metadata and headings", async ({
    request,
  }) => {
    const documents = [];

    for (const path of [
      "/brands",
      "/categories/home",
      "/categories/home/furniture",
    ]) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(200);
      const metadata = metadataFrom(await response.text());
      expect(metadata.title, `${path} title`).toBeTruthy();
      expect(metadata.description, `${path} description`).toBeTruthy();
      expect(metadata.h1, `${path} h1`).toBeTruthy();
      expect(metadata.title, `${path} repeats the site name`).not.toMatch(
        /Formoria\s*\|\s*Formoria/,
      );
      documents.push(metadata);
    }

    expect(new Set(documents.map(({ title }) => title)).size).toBe(3);
    expect(new Set(documents.map(({ description }) => description)).size).toBe(
      3,
    );
    expect(new Set(documents.map(({ h1 }) => h1)).size).toBe(3);
  });

  test("@smoke L1 and L2 advertise reciprocal localized canonicals", async ({
    page,
  }) => {
    for (const route of ["/categories/home", "/categories/home/furniture"]) {
      for (const localePrefix of ["", "/en"]) {
        await page.goto(`${localePrefix}${route}`);
        const localizedRoute = `${localePrefix}${route}`;

        await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
          "href",
          `${ORIGIN}${localizedRoute}`,
        );
        await expect(
          page.locator('link[rel="alternate"][hreflang="zh-TW"]'),
        ).toHaveAttribute("href", `${ORIGIN}${route}`);
        await expect(
          page.locator('link[rel="alternate"][hreflang="en"]'),
        ).toHaveAttribute("href", `${ORIGIN}/en${route}`);
        await expect(
          page.locator('link[rel="alternate"][hreflang="x-default"]'),
        ).toHaveAttribute("href", `${ORIGIN}${route}`);
      }
    }
  });

  test("L2 breadcrumb identifies the current page without linking it", async ({
    page,
  }) => {
    await page.goto("/categories/home/furniture");

    const breadcrumb = page.getByRole("navigation", { name: "麵包屑導覽" });
    await expect(breadcrumb).toBeVisible();
    await expect(
      breadcrumb.getByRole("link", { name: "台灣品牌目錄" }),
    ).toHaveAttribute("href", "/brands");
    await expect(
      breadcrumb.getByRole("link", { name: "居家生活" }),
    ).toHaveAttribute("href", "/categories/home");
    const current = breadcrumb.locator('[aria-current="page"]');
    await expect(current).toHaveCount(1);
    await expect(current).toHaveText("家具");
    expect(await current.evaluate((element) => element.tagName)).toBe("SPAN");
  });

  test("L1 server HTML contains only eligible, descriptively named child links", async ({
    request,
  }) => {
    const response = await request.get("/categories/home");
    expect(response.status()).toBe(200);
    const $ = load(await response.text());
    const childLinks = $('nav[aria-label="探索此分類的子分類"] a')
      .map((_, element) => ({
        href: $(element).attr("href"),
        name: $(element).text().replace(/\s+/g, " ").trim(),
      }))
      .get();

    expect(childLinks).toHaveLength(3);
    expect(childLinks).toEqual(
      expect.arrayContaining([
        { href: "/categories/home/storage", name: "居家生活・收納用品" },
        { href: "/categories/home/tableware", name: "居家生活・餐具" },
        { href: "/categories/home/furniture", name: "居家生活・家具" },
      ]),
    );
    expect(childLinks.some(({ href }) => href?.endsWith("/bedding"))).toBe(
      false,
    );
    expect(childLinks.every(({ name }) => name.includes("居家生活"))).toBe(
      true,
    );
    expect(childLinks.some(({ name }) => name === "查看全部")).toBe(false);
  });

  test("landing facts are server-rendered once and keep the first card above the fold", async ({
    page,
    request,
  }) => {
    const response = await request.get("/categories/home");
    const html = await response.text();
    expect(html).toContain("居家生活涵蓋家具、收納、照明、餐桌器皿與日常布置");
    expect(html).toMatch(/共 \d+ 個品牌/);
    expect(html).toMatch(/更新於 \d{4}年\d{1,2}月\d{1,2}日/);

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/categories/home");
    const liveRegion = page.locator('main [aria-live="polite"]');
    await expect(liveRegion).toHaveCount(1);
    await expect(liveRegion).toContainText(/共 \d+ 個品牌/);
    const firstCardTop = await page
      .locator('main [role="list"] [role="listitem"]')
      .first()
      .evaluate((element) => element.getBoundingClientRect().top);
    expect(firstCardTop).toBeLessThan(500);
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

  test("non-launch and faceted category pages expose their noindex state", async ({
    page,
  }) => {
    await page.goto("/categories/home/bedding");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      "noindex, follow",
    );
    await expect(page.locator('link[rel="alternate"][hreflang]')).toHaveCount(
      0,
    );

    await page.goto("/categories/home?price=2");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      "noindex, follow",
    );
  });

  test("page 2 remains self-canonical on the category landing", async ({
    page,
  }) => {
    await page.goto("/categories/home?page=2");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      `${ORIGIN}/categories/home?page=2`,
    );
  });

  test("unknown categories and wrong-parent subcategories return direct 404s", async ({
    request,
  }) => {
    for (const path of [
      "/categories/not-a-real-category",
      "/categories/fashion/furniture",
    ]) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status(), path).toBe(404);
      expect(response.headers().location, path).toBeUndefined();
    }
  });

  test("category search and out-of-range pages avoid extra recovery content", async ({
    page,
  }) => {
    await page.goto(
      "/categories/home?search=e2e-nothing-that-exists-directory-architecture",
    );
    await expect(page.locator("[data-empty]")).toBeVisible();
    await expect(page.getByText(/更新於 \d{4}年/)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "你可能想找" })).toHaveCount(
      0,
    );

    await page.goto("/categories/home?page=999");
    await expect(page).toHaveURL(/\/categories\/home\?page=999$/);
    await expect(page.locator("[data-empty]")).toBeVisible();
    await expect(page.getByRole("heading", { name: "你可能想找" })).toHaveCount(
      0,
    );
  });
});
