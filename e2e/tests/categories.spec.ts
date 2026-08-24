import { expect, test } from "@playwright/test";
import { load } from "cheerio";

import { DEFAULT_PAGE_SIZE } from "../../src/lib/pagination";

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
          `${CANONICAL_ORIGIN}${localizedRoute}`,
        );
        await expect(
          page.locator('link[rel="alternate"][hreflang="zh-TW"]'),
        ).toHaveAttribute("href", `${CANONICAL_ORIGIN}${route}`);
        await expect(
          page.locator('link[rel="alternate"][hreflang="en"]'),
        ).toHaveAttribute("href", `${CANONICAL_ORIGIN}/en${route}`);
        await expect(
          page.locator('link[rel="alternate"][hreflang="x-default"]'),
        ).toHaveAttribute("href", `${CANONICAL_ORIGIN}${route}`);
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
    const links = $('nav[aria-label="探索此分類的子分類"] a');

    expect(links).toHaveLength(3);
    expect(links.map((_, link) => $(link).attr("href")).get()).toEqual([
      "/categories/home/storage",
      "/categories/home/tableware",
      "/categories/home/furniture",
    ]);
    expect(links.map((_, link) => $(link).text().trim()).get()).toEqual([
      "收納用品",
      "餐具",
      "家具",
    ]);
  });

  test("landing facts are server-rendered once with a valid result state", async ({
    page,
    request,
  }) => {
    const response = await request.get("/categories/home");
    const html = await response.text();
    expect(html).toContain(
      "從家具、收納、照明到餐桌器皿與佈置小物；在小坪數的房間裡，尺寸和收納方式通常比風格更早決定。",
    );
    expect(html).toMatch(/共 \d+ 個品牌/);
    expect(html).toMatch(/更新於 \d{4}年\d{1,2}月\d{1,2}日/);

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/categories/home");
    await expect(
      page.getByText("本分類聚焦讓居住空間更好使用的物件，而不只限於裝飾品。", {
        exact: false,
      }),
    ).toHaveCount(1);
    // The 分類說明 absence assertion that used to sit here is gone. Its
    // heading came from `categories.landing.definitionTitle`, whose renderer
    // was already deleted earlier in this delta; this sweep removed the
    // orphaned key. With no component able to emit that heading under any
    // condition, the assertion could no longer fail — the same rot this sweep
    // exists to remove. 常見問題 below is still rendered on the taxonomy
    // landing pages, so that one remains a real guard.
    await expect(page.getByRole("heading", { name: "常見問題" })).toHaveCount(
      0,
    );
    const liveRegion = page.locator('main [aria-live="polite"]');
    await expect(liveRegion).toHaveCount(1);
    await expect(liveRegion).toContainText(/共 \d+ 個品牌/);

    // The "valid result state" the test name promises: the announced count and
    // the rendered cards must agree. Asserted WITHOUT a branch on purpose —
    // the previous form accepted the empty state as an alternative, so it
    // passed on either polarity, and a version that branches on the count
    // instead of an `.or()` has the same hole. `home` is a seeded L1 with
    // supply, so an announced zero here is a real defect and must fail rather
    // than select a second acceptable outcome.
    const announcement = await liveRegion.innerText();
    const announced = Number(/共 (\d+) 個品牌/.exec(announcement)?.[1] ?? "0");
    expect(announced).toBeGreaterThan(0);
    await expect(
      page.locator('main [role="list"] [role="listitem"]'),
    ).toHaveCount(Math.min(announced, DEFAULT_PAGE_SIZE));
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

    await page.goto("/categories/home?material=ceramic");
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
      `${CANONICAL_ORIGIN}/categories/home?page=2`,
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
    await expect(page.getByRole("heading", { name: "類似的選擇" })).toHaveCount(
      0,
    );

    await page.goto("/categories/home?page=999");
    await expect(page).toHaveURL(/\/categories\/home\?page=999$/);
    await expect(page.locator("[data-empty]")).toBeVisible();
    await expect(page.getByRole("heading", { name: "類似的選擇" })).toHaveCount(
      0,
    );
  });
});
