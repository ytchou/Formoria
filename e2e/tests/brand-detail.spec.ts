import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "../fixtures/auth";
import type { Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { load } from "cheerio";
import { getServiceClient, seedBrand, SeededBrand } from "../helpers/seed";
import { e2eBrandImageKey, e2eProxyImageUrl } from "../helpers/image-refs";
import { BUDGET, POLL } from "../budgets";
import { e2eProxyImageUrl } from "../helpers/image-refs";

/**
 * The three channel corrections (purchase link, stockist, social link) share
 * one 「告訴我們」 menu at the end of the where-to-buy block. The trigger ships in
 * the server-rendered HTML, so a missing one is a real regression rather than a
 * timing problem: assert it before the retry loop so that case does not surface
 * as an opaque "predicate timed out" on the dialog. The page is statically
 * served and hydrates afterwards, so a click that lands too early is a silent
 * no-op — retry the idempotent open instead of sleeping on a guessed hydration
 * delay (same pattern as openCategoryDialog in brand-corrections.spec.ts).
 */
async function openChannelCorrection(
  page: Page,
  menuItemName: string,
  dialogTitle: string,
) {
  const trigger = page.getByRole("button", { name: "告訴我們", exact: true });
  await expect(trigger).toBeVisible();

  const menuItem = page.getByRole("menuitem", {
    name: menuItemName,
    exact: true,
  });
  const dialog = page.getByRole("dialog", { name: dialogTitle });
  await expect(async () => {
    if (!(await dialog.isVisible())) {
      // A second click on an open menu's trigger would close it again.
      if (!(await menuItem.isVisible())) await trigger.click();
      await menuItem.click();
    }
    await expect(dialog).toBeVisible({ timeout: BUDGET.INTERACTIVE });
  }).toPass(POLL.UI);
  return dialog;
}

test.describe("Brand detail deep", () => {
  let brandHref: string;
  let seeded: SeededBrand;

  test.beforeAll(async ({}, workerInfo) => {
    seeded = await seedBrand({
      name: "detail",
      status: "approved",
      workerIndex: workerInfo.workerIndex,
      withLinks: true,
      // The FAQ cases below need brand *evidence*, not links: the presets that
      // survive the subcategory evidence gate.
      withFaqEvidence: true,
    });
    // A story gives the page its 品牌故事 section, which with where-to-buy, FAQ
    // and social reaches the four sections the mobile section nav needs.
    const { error: descriptionError } = await getServiceClient()
      .from("brands")
      .update({ description: "E2E 測試品牌的故事。" })
      .eq("id", seeded.brand.id);
    if (descriptionError) {
      throw new Error(
        `Failed to seed brand description: ${descriptionError.message}`,
      );
    }
    brandHref = `/brands/${seeded.slug}`;
  });

  test.afterAll(async () => {
    await seeded.cleanup();
  });

  test("@smoke brand hero shows one metadata line under the name in both locales", async ({
    page,
  }) => {
    await page.goto(brandHref);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: BUDGET.INTERACTIVE,
    });
    // The seeded brand has a category and a founding year but no city, so the
    // city part is omitted rather than printed as a placeholder.
    await expect(
      page.getByText("居家生活 · 2020 年創立", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("尚無資料")).toHaveCount(0);
    await expect(page.getByRole("region", { name: "品牌資訊" })).toHaveCount(0);

    await page.goto(`/en/brands/${seeded.slug}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: BUDGET.INTERACTIVE,
    });
    await expect(
      page.getByText("Home & Living · Founded 2020", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Not available")).toHaveCount(0);

    await expect(
      page.getByText(/something went wrong|not found|error|發生錯誤/i),
    ).not.toBeVisible();
  });

  test("brand detail shows social and purchase links in two separate sections", async ({
    page,
  }) => {
    // The controlled brand has links data to verify two-section structure.
    await page.goto(`/brands/${seeded.slug}`);

    // Verify the social section heading is visible
    await expect(
      page.getByRole("heading", { name: "社群平台", level: 2 }),
    ).toBeVisible({
      timeout: BUDGET.INTERACTIVE,
    });

    // Verify the purchase sub-heading (under where-to-buy's h2) is visible
    await expect(
      page.getByRole("heading", { name: "線上購買", level: 3 }),
    ).toBeVisible({
      timeout: BUDGET.INTERACTIVE,
    });
  });

  // Ordering is a separate failure from presence, so it is a separate test: a
  // merged case would hide the ordering result the moment a heading is missing
  // (see commit 4a4fc7a8). The extra `goto` is one cached load of an
  // already-seeded brand.
  test("links sections are structurally separate (where to buy before social)", async ({
    page,
  }) => {
    await page.goto(`/brands/${seeded.slug}`);

    const whereToBuyHeading = page.getByRole("heading", {
      name: "哪裡買得到",
      level: 2,
    });
    const socialHeading = page.getByRole("heading", {
      name: "社群平台",
      level: 2,
    });

    await expect(whereToBuyHeading).toBeVisible({
      timeout: BUDGET.INTERACTIVE,
    });
    await expect(socialHeading).toBeVisible();

    // The route to buy comes before social in document order (BD-12).
    const whereToBuyBox = await whereToBuyHeading.boundingBox();
    const socialBox = await socialHeading.boundingBox();
    expect(whereToBuyBox).not.toBeNull();
    expect(socialBox).not.toBeNull();
    expect(whereToBuyBox!.y).toBeLessThan(socialBox!.y);
  });

  test("tab nav click scrolls to correct section", async ({ page }) => {
    // The section nav is a mobile-only strip (BD-27).
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/brands/${seeded.slug}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: BUDGET.INTERACTIVE,
    });

    // The seeded brand has social links — the tab nav must include a "社群平台" link
    const nav = page.getByRole("navigation", { name: "本頁導覽" });
    await nav.getByRole("link", { name: "社群平台" }).click();

    // After the smooth-scroll the social section heading must be visible in the viewport
    await expect(
      page.getByRole("heading", { name: "社群平台", level: 2 }),
    ).toBeInViewport({
      timeout: BUDGET.RENDERED,
    });
  });

  test("mobile brand detail keeps the website CTA in the document flow", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/brands/${seeded.slug}`);

    // Scoped to <main>: once the hero CTA scrolls away, the mobile route-out
    // bar (portalled to <body>) renders a second 前往官網 link.
    const websiteCta = page.getByRole("main").getByRole("link", {
      name: "前往官網",
      exact: true,
    });
    await expect(websiteCta).toHaveCount(1);
    await expect(
      page.getByRole("link", { name: "前往品牌官網", exact: true }),
    ).toHaveCount(0);
    await websiteCta.scrollIntoViewIfNeeded();
    await expect(websiteCta).toBeInViewport();

    // Scrolls to the end of the document rather than to a named section: the
    // assertion is only that the CTA scrolls away with the page instead of
    // sticking, so it must not depend on which optional sections are enabled.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(websiteCta).not.toBeInViewport();
  });

  test("mobile section navigation stays operable above scrolling content", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/brands/${seeded.slug}`);

    const nav = page.getByRole("navigation", { name: "本頁導覽" });
    await page.locator("#social").evaluate((section) => {
      window.scrollBy(0, section.getBoundingClientRect().top - 105);
    });

    // This journey targets the where-to-buy section; stockists have their own
    // seeded coverage below.
    await nav.getByRole("link", { name: "哪裡買得到" }).click();
    await expect(
      page.getByRole("heading", { name: "哪裡買得到", level: 2 }),
    ).toBeInViewport({
      timeout: BUDGET.RENDERED,
    });
  });

  test('external links have target="_blank" and rel="noopener"', async ({
    page,
  }) => {
    await page.goto(brandHref);
    const externalLinks = page.locator(
      'a[href^="http"]:not([href*="localhost"])',
    );
    const count = await externalLinks.count();
    for (let i = 0; i < Math.min(count, 5); i++) {
      const link = externalLinks.nth(i);
      await expect(link).toHaveAttribute("target", "_blank");
      await expect(link).toHaveAttribute("rel", /noopener/);
    }
  });

  // The ONLY assertion anywhere in the repo that a brand page emits og:title.
  // Restored deliberately: this repo has already shipped og:image suppressed
  // site-wide while every unit metadata test passed. The canonical and JSON-LD
  // assertions that used to sit here are NOT restored — both are re-asserted
  // later in this same file.
  test("SEO meta tags are present", async ({ page }) => {
    await page.goto(brandHref);
    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);
    const ogTitle = await page
      .locator('meta[property="og:title"]')
      .getAttribute("content");
    expect(ogTitle?.length).toBeGreaterThan(0);
    const description = await page
      .locator('meta[name="description"]')
      .getAttribute("content");
    expect(description?.length).toBeGreaterThan(0);
  });

  test("FAQ renders on a data-rich brand", async ({ page }) => {
    test.setTimeout(BUDGET.TEST.MUTATION);
    // Seeded via `withFaqEvidence`: subcategories, not links, are what the FAQ
    // floor gates on.
    await expect(async () => {
      await page.goto(`/brands/${seeded.slug}`, {
        waitUntil: "domcontentloaded",
      });
      // FAQ section heading (zh-TW default locale — brandDetail.sections.faq)
      await expect(
        page.getByRole("heading", { name: "常見問題", level: 2 }),
      ).toBeVisible({
        timeout: BUDGET.INTERACTIVE,
      });
    }).toPass(POLL.DB);

    // At least one FAQ question is present and visible. The FAQ is an open
    // definition list: each pair is a wrapper carrying the anchor id.
    const questions = page.locator('[id^="faq-"] dt');
    await expect(questions.first()).toBeVisible();

    // The seeded evidence field must pull its preset onto the page.
    await expect(page.locator("#faq-main-products")).toHaveCount(1);

    const jsonLdNodes = await page
      .locator('script[type="application/ld+json"]')
      .allTextContents();
    const faqJsonLd = jsonLdNodes
      .map(
        (content) =>
          JSON.parse(content) as { "@type"?: string },
      )
      .find((node) => node["@type"] === "FAQPage");
    expect(faqJsonLd).toBeUndefined();
  });

  test("FAQ renders as an open list with answers in the server HTML", async ({
    page,
    request,
  }) => {
    test.setTimeout(BUDGET.TEST.MUTATION);
    // The whole point of DEV-1317: answers must be readable without opening
    // anything, and DESIGN.md §7 forbids a collapsed panel outright. Nothing
    // here clicks.
    await expect(async () => {
      await page.goto(`/brands/${seeded.slug}`, {
        waitUntil: "domcontentloaded",
      });
      await expect(
        page.getByRole("heading", { name: "常見問題", level: 2 }),
      ).toBeVisible({
        timeout: BUDGET.INTERACTIVE,
      });
    }).toPass(POLL.DB);

    const firstItem = page.locator('[id^="faq-"]').first();
    // The first rendered item is the main-products floor.
    await expect(firstItem).toHaveAttribute("id", "faq-main-products");
    await expect(firstItem.locator("dd")).toContainText("商品類型包括");
    await expect(page.locator("#faq details")).toHaveCount(0);

    // The literal acceptance criterion — "verifiable by curl". Asserting on the
    // rendered DOM alone would still pass if a client effect injected the text
    // after hydration, which is exactly the regression this guards against.
    const response = await request.get(`/brands/${seeded.slug}`);
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).toContain("商品類型包括");
    const $ = load(html);
    const serverItem = $('[id^="faq-"]').first();
    expect(serverItem.attr("id")).toBe("faq-main-products");
    expect(serverItem.find("dd").text()).toContain("商品類型包括");
    expect($("#faq details")).toHaveLength(0);
  });
});

test.describe("Brand detail — product shelf focus", () => {
  let seeded: SeededBrand | undefined;
  const productKey = "perch-wireless-table-lamp";
  const productName = "Perch 棲木無線桌燈";

  test.beforeAll(async ({}, workerInfo) => {
    seeded = await seedBrand({
      name: "product-shelf-focus",
      status: "approved",
      workerIndex: workerInfo.workerIndex,
    });

    const supabase = getServiceClient();
    const { data: product, error: productError } = await supabase
      .from("curated_products")
      .insert({
        brand_id: seeded.brand.id,
        key: productKey,
        name_zh: productName,
        category: "home",
        subcategory: "lighting",
        official_url:
          "https://sammm-studio.com/products/perch-wireless-table-lamp",
        // The shelf skips photo-less products (DEV-1950), so the seed needs a
        // path `safeImageSrc` accepts. The image need not resolve for this spec.
        image_url: e2eProxyImageUrl(`curated-products/e2e/${productKey}.webp`),
        source_checked_at: new Date().toISOString(),
        product_description_zh:
          "PETG 懸臂結構搭配 Type-C 充電、觸控調光與 3000K 暖白光。",
        // Public reads drop a product with no renderable image (DEV-1962).
        image_url: e2eProxyImageUrl(
          `curated-products/${seeded.brand.id}/${productKey}/e2e.webp`,
        ),
        visible: true,
      })
      .select("id")
      .single();
    if (productError || !product) {
      throw new Error(`curated product seed failed: ${productError?.message}`);
    }

    const { error: sourceError } = await supabase
      .from("curated_product_sources")
      .insert({
        product_id: product.id,
        url: "https://sammm-studio.com/products/perch-wireless-table-lamp",
        checked_at: new Date().toISOString(),
        state: "active",
      });
    if (sourceError) {
      throw new Error(
        `curated product source seed failed: ${sourceError.message}`,
      );
    }
  });

  test.afterAll(async () => {
    await seeded?.cleanup();
  });

  // DEV-1950 replaced the hover-only caption and its focus-only wrapper with a
  // static name and a real link, so the old "caption does not pin open" check
  // has nothing left to test. This asserts the new contract instead.
  test("shelf tile shows its name at rest and links onward", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 929 });
    await page.goto(`/brands/${seeded!.slug}`);

    const tile = page.locator(`#product-${productKey}`);
    await expect(tile).toBeVisible({ timeout: BUDGET.INTERACTIVE });
    await tile.scrollIntoViewIfNeeded();

    await expect(
      tile.getByRole("heading", { name: productName }),
    ).toBeVisible();

    const productLink = tile.getByRole("link", {
      name: new RegExp(`^${productName}`),
    });
    await expect(productLink).toHaveAttribute(
      "href",
      new RegExp(`#product-${productKey}$`),
    );
    await expect(tile.locator('[tabindex="0"]:not(button)')).toHaveCount(0);
    await expect(productLink.locator("button")).toHaveCount(0);

    await expect(
      tile.getByRole("link", { name: /前往品牌官方網站/ }),
    ).toHaveAttribute(
      "href",
      "https://sammm-studio.com/products/perch-wireless-table-lamp",
    );
  });
});

test.describe("Brand detail — hero gallery at desktop widths", () => {
  // DEV-1948: from xl (1280px) up, the hero frame is a grid item beside the
  // vertical thumbnail rail. With `mx-auto` and no definite width it shrank to
  // its only content, an absolutely positioned image, and measured 0×0.
  // Two images are needed: the rail and the grid exist only for a gallery.
  //
  // A real photograph, not a one-pixel stub: Chrome renders the optimizer's
  // 1×1 WebP output as a broken image (`complete` but `naturalWidth` 0), so
  // the stub failed the naturalWidth assertion on a hero that rendered fine.
  const HERO_WEBP = readFileSync(
    join(process.cwd(), "public/images/home-hero.webp"),
  );
  let seeded: SeededBrand;
  let imageKeys: string[] = [];

  test.beforeAll(async ({}, workerInfo) => {
    seeded = await seedBrand({
      name: "hero-gallery",
      status: "approved",
      workerIndex: workerInfo.workerIndex,
    });
    const supabase = getServiceClient();
    imageKeys = [
      e2eBrandImageKey(seeded.brand.id, "hero.webp"),
      e2eBrandImageKey(seeded.brand.id, "detail.webp"),
    ];
    for (const key of imageKeys) {
      const { error } = await supabase.storage
        .from("brand-images")
        .upload(key, HERO_WEBP, {
          contentType: "image/webp",
          upsert: true,
        });
      if (error) throw new Error(`Failed to seed ${key}: ${error.message}`);
    }
    const { error: imageError } = await supabase.from("brand_images").insert(
      imageKeys.map((key, index) => ({
        brand_id: seeded.brand.id,
        storage_path: key,
        source_url: key,
        source: "legacy",
        status: "active",
        sort_order: index,
      })),
    );
    if (imageError) throw imageError;
    const { error: heroError } = await supabase
      .from("brands")
      .update({ hero_image_storage_path: imageKeys[0] })
      .eq("id", seeded.brand.id);
    if (heroError) throw heroError;
  });

  test.afterAll(async () => {
    await seeded?.cleanup();
    if (imageKeys.length > 0) {
      const { error } = await getServiceClient()
        .storage.from("brand-images")
        .remove(imageKeys);
      if (error) throw new Error(`Failed to clean images: ${error.message}`);
    }
  });

  for (const width of [1280, 1440]) {
    test(`the hero frame and its first image render at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/brands/${seeded.slug}`);

      const hero = page.locator("[data-brand-hero]");
      await expect(hero).toBeVisible({ timeout: BUDGET.SERVER_RENDER });
      const box = await hero.boundingBox();
      expect(box?.width ?? 0).toBeGreaterThan(0);
      expect(box?.height ?? 0).toBeGreaterThan(0);

      const firstImage = hero.locator("img").first();
      await expect
        .poll(
          () =>
            firstImage.evaluate((img: HTMLImageElement) =>
              img.complete ? img.naturalWidth : 0,
            ),
          POLL.UI,
        )
        .toBeGreaterThan(0);
    });
  }
});

test.describe("Brand detail — brand without links", () => {
  let seeded: SeededBrand;

  test.beforeAll(async ({}, workerInfo) => {
    // No withLinks — brand has no social/purchase URLs at all
    seeded = await seedBrand({
      name: "nolinks",
      status: "approved",
      workerIndex: workerInfo.workerIndex,
    });
  });

  test.afterAll(async () => {
    await seeded.cleanup();
  });

  test("both link sections stay and say no link is known when brand has no links", async ({
    page,
  }) => {
    test.setTimeout(BUDGET.TEST.MUTATION);
    // ISR pages may serve a stale cache — poll-reload until the seeded brand page renders
    await expect(async () => {
      await page.goto(`/brands/${seeded.slug}`, {
        waitUntil: "domcontentloaded",
      });
      await expect(page.getByRole("heading", { level: 1 })).toContainText(
        "nolinks",
        {
          timeout: BUDGET.INTERACTIVE,
        },
      );
    }).toPass(POLL.DB);

    // Both link sections stay rendered when the brand has no links, and each
    // says so in one muted line instead of a dimmed chip per destination.
    await expect(
      page.getByRole("heading", { name: "社群平台", level: 2 }),
    ).toHaveCount(1);
    await expect(
      page.getByRole("heading", { name: "線上購買", level: 3 }),
    ).toHaveCount(1);
    await expect(page.getByText("還沒有線上購買的連結。")).toBeVisible();
    await expect(page.getByText("還沒有社群連結。")).toBeVisible();

    // No inert chips: an unknown destination renders nothing at all.
    for (const sectionId of ["#where-to-buy", "#social"]) {
      await expect(
        page.locator(sectionId).locator('[aria-disabled="true"]'),
      ).toHaveCount(0);
    }
    for (const label of ["Instagram", "Threads", "Facebook", "品牌官網"]) {
      await expect(
        page.locator("#social, #where-to-buy").getByText(label, {
          exact: true,
        }),
      ).toHaveCount(0);
    }

    await expect(
      page.getByRole("button", { name: "告訴我們", exact: true }),
    ).toBeVisible();
  });
});

test.describe("Brand detail — myship-only purchase channel", () => {
  let seeded: SeededBrand;

  test.beforeAll(async ({}, workerInfo) => {
    // purchase_myship set, purchase_website NULL — the website-centric fixtures
    // above cannot tell "the purchase section works" apart from "purchase_website
    // works". Guards against a new channel being half-wired on the detail page.
    seeded = await seedBrand({
      name: "myship-only",
      status: "approved",
      workerIndex: workerInfo.workerIndex,
      withLinks: true,
      onlineStore: "myship",
    });
  });

  test.afterAll(async () => {
    await seeded.cleanup();
  });

  test("myship renders as a live link while the unknown website is absent", async ({
    page,
  }) => {
    test.setTimeout(BUDGET.TEST.MUTATION);
    await expect(async () => {
      await page.goto(`/brands/${seeded.slug}`, {
        waitUntil: "domcontentloaded",
      });
      await expect(page.getByRole("heading", { level: 1 })).toContainText(
        "myship-only",
        {
          timeout: BUDGET.INTERACTIVE,
        },
      );
    }).toPass(POLL.DB);

    await expect(
      page.getByRole("link", { name: "前往 7-ELEVEN 賣貨便" }),
    ).toBeVisible();

    // The website is absent, not inert: no chip, no link, and one muted line
    // stands in for every store with no known link.
    const whereToBuy = page.locator("#where-to-buy");
    await expect(
      whereToBuy.getByText("品牌官網", { exact: true }),
    ).toHaveCount(0);
    await expect(whereToBuy.locator('[aria-disabled="true"]')).toHaveCount(0);
    await expect(
      whereToBuy.getByText("還沒有其他通路的連結。"),
    ).toBeVisible();
  });
});

test.describe("Brand detail — hidden brand", () => {
  let seeded: SeededBrand;

  test.beforeAll(async ({}, workerInfo) => {
    seeded = await seedBrand({
      name: "hidden-brand",
      status: "hidden",
      workerIndex: workerInfo.workerIndex,
    });
  });

  test.afterAll(async () => {
    await seeded.cleanup();
  });

  test("hidden brands are not publicly accessible", async ({ page }) => {
    await page.goto(`/brands/${seeded.slug}`);

    await expect(
      page.getByRole("heading", { name: seeded.brand.name }),
    ).toHaveCount(0);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      /noindex/i,
    );
  });
});

test.describe("Brand detail — historical slugs", () => {
  let approved: SeededBrand;
  let hidden: SeededBrand;
  let approvedOldSlug: string;
  let hiddenOldSlug: string;

  test.beforeAll(async ({}, workerInfo) => {
    approved = await seedBrand({
      name: "redirect-approved",
      status: "approved",
      workerIndex: workerInfo.workerIndex,
    });
    hidden = await seedBrand({
      name: "redirect-hidden",
      status: "hidden",
      workerIndex: workerInfo.workerIndex,
    });
    approvedOldSlug = `${approved.slug}-old`;
    hiddenOldSlug = `${hidden.slug}-old`;

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    const { error: descriptionError } = await supabase
      .from("brands")
      .update({
        description: "這是經過驗證的台灣品牌。",
        description_en: "This is a verified Taiwanese brand.",
        blurb_en: "Independent design and careful local production.",
      })
      .eq("id", approved.brand.id);
    if (descriptionError) {
      throw new Error(
        `Failed to seed localized brand copy: ${descriptionError.message}`,
      );
    }

    const { error: redirectError } = await supabase
      .from("brand_slug_redirects")
      .insert([
        { old_slug: approvedOldSlug, new_slug: approved.slug },
        { old_slug: hiddenOldSlug, new_slug: hidden.slug },
      ]);
    if (redirectError) {
      throw new Error(
        `Failed to seed brand redirects: ${redirectError.message}`,
      );
    }
  });

  test.afterAll(async () => {
    if (approved) await approved.cleanup();
    if (hidden) await hidden.cleanup();
  });

  test("approved historical slugs redirect once to localized self-canonical pages", async ({
    request,
  }) => {
    const cases = [
      {
        source: `/brands/${approvedOldSlug}`,
        target: `/brands/${approved.slug}`,
      },
      {
        source: `/en/brands/${approvedOldSlug}`,
        target: `/en/brands/${approved.slug}`,
      },
    ];

    for (const { source, target } of cases) {
      const redirectResponse = await request.get(source, {
        maxRedirects: 0,
      });
      expect(redirectResponse.status()).toBe(308);
      expect(redirectResponse.headers().location).toBe(target);

      const targetResponse = await request.get(target, {
        maxRedirects: 0,
      });
      expect(targetResponse.status()).toBe(200);
      const $ = load(await targetResponse.text());
      const canonical = $('link[rel="canonical"]').attr("href");
      expect(new URL(canonical!).pathname).toBe(target);
      expect($('link[rel="alternate"][hreflang="zh-TW"]').length).toBe(1);
      expect($('link[rel="alternate"][hreflang="en"]').length).toBe(1);
    }
  });

  test("historical slugs targeting hidden brands return direct 404 responses", async ({
    request,
  }) => {
    for (const source of [
      `/brands/${hiddenOldSlug}`,
      `/en/brands/${hiddenOldSlug}`,
    ]) {
      const response = await request.get(source, {
        maxRedirects: 0,
      });
      expect(response.status()).toBe(404);
      expect(response.headers().location).toBeUndefined();
    }
  });
});

test.describe("Brand detail — public locations and retail stockists", () => {
  let seeded: SeededBrand;
  let emptySeeded: SeededBrand;

  const confirmedStoreName = "[E2E-TEST] Brand direct store";
  const confirmedStoreAddress = "台北市信義區信義路五段 7 號";
  // A confirmed stockist with no region and no address. It is what keeps the
  // grouped layout above its four-stockist threshold, and it lands in the
  // overseas fallback group because no Taiwan region resolves for it.
  const unlocatedStockistName = "[E2E-TEST] Brand stockist without a location";
  // Community submissions are invisible until they are approved (DEV-1513), so
  // the only community rows that can render are ones already decided on. Two of
  // them, because the grouped layout needs four visible stockists to switch on.
  const approvedCommunityName = "[E2E-TEST] Approved community stockist";
  const ownerConfirmedCommunityName =
    "[E2E-TEST] Owner-confirmed community stockist";
  const submittedStockistName = "[E2E-TEST] Submitted community stockist";
  const confirmedStoreUrl = "https://example.com/e2e-brand-store";
  const evidenceSourceUrl = "https://example.com/e2e-stockists";
  const submittedStockistUrl = "https://example.com/e2e-submitted-stockist";

  test.beforeAll(async ({}, workerInfo) => {
    seeded = await seedBrand({
      name: "mixed-stockists",
      status: "approved",
      workerIndex: workerInfo.workerIndex,
    });
    emptySeeded = await seedBrand({
      name: "without-stockists",
      status: "approved",
      workerIndex: workerInfo.workerIndex,
    });

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Supabase service-role environment is required");
    }

    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const stockistRows = [
      {
        brand_id: seeded.brand.id,
        name: confirmedStoreName,
        normalized_name: "e2e-brand-direct-store",
        region_label: "臺北市",
        address: confirmedStoreAddress,
        url: confirmedStoreUrl,
        source: "import",
        source_url: evidenceSourceUrl,
        fetched_at: "2026-08-11T00:00:00.000Z",
        location_type: "direct_store",
        country: "TW",
        owner_status: "none",
      },
      {
        brand_id: seeded.brand.id,
        name: unlocatedStockistName,
        normalized_name: "e2e-brand-unlocated-stockist",
        region_label: null,
        address: null,
        url: null,
        source: "owner",
        owner_status: "confirmed",
      },
      {
        brand_id: seeded.brand.id,
        name: approvedCommunityName,
        normalized_name: "e2e-approved-community-stockist",
        region_label: "臺中市",
        address: null,
        url: null,
        source: "community",
        owner_status: "confirmed",
      },
      {
        brand_id: seeded.brand.id,
        name: ownerConfirmedCommunityName,
        normalized_name: "e2e-owner-confirmed-community-stockist",
        region_label: "新北市",
        address: null,
        url: null,
        source: "community",
        owner_status: "confirmed",
      },
    ];

    const { error: stockistsError } = await serviceClient
      .from("brand_channels")
      .insert(stockistRows);
    if (stockistsError) {
      throw new Error(
        `Failed to seed brand stockists: ${stockistsError.message}`,
      );
    }
  });

  test.afterAll(async () => {
    await Promise.all([seeded.cleanup(), emptySeeded.cleanup()]);
  });

  test("stockists render as an open list grouped by region", async ({
    page,
  }) => {
    test.setTimeout(BUDGET.TEST.MUTATION);
    await expect(async () => {
      await page.goto(`/brands/${seeded.slug}`, {
        waitUntil: "domcontentloaded",
      });
      await expect(page.getByRole("heading", { level: 1 })).toContainText(
        seeded.brand.name,
        {
          timeout: BUDGET.INTERACTIVE,
        },
      );
      // Region subheads are named by the region alone; the count sits
      // beside the heading, not inside it. Either spelling of 台 passes:
      // the cities.* labels move from 臺 to 台 in DEV-1971.
      await expect(
        page.getByRole("heading", { name: /^[台臺]北市$/, level: 4 }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: /^[台臺]中市$/, level: 4 }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "實體通路", level: 3 }),
      ).toBeVisible();
    }).toPass(POLL.DB);

    await expect(
      page
        .locator('[data-stockist-kind="taipei"]')
        .getByText("1 家", { exact: true }),
    ).toBeVisible();
    // Open by default: every store is on screen without a click.
    for (const name of [
      confirmedStoreName,
      unlocatedStockistName,
      approvedCommunityName,
      ownerConfirmedCommunityName,
    ]) {
      await expect(
        page.locator("[data-stockist-row]").filter({ hasText: name }),
      ).toBeVisible();
    }
    await expect(page.locator("details[data-stockist-kind]")).toHaveCount(0);
  });

  test("an imported stockist renders its address and Maps link", async ({
    page,
  }) => {
    await page.goto(`/brands/${seeded.slug}`, {
      waitUntil: "domcontentloaded",
    });

    // The whole entry is the Maps link, and it prints the district.
    const stockistRow = page
      .locator("[data-stockist-row]")
      .filter({ hasText: confirmedStoreName });
    await expect(stockistRow.getByRole("link")).toHaveAttribute(
      "href",
      /^https:\/\/www\.google\.com\/maps\/search\//,
    );
    await expect(stockistRow).toContainText("信義區");
    // An imported stockist must not publish when it was scraped. Anchored on
    // any rendered date rather than on one label ("讀取於", which no message
    // key emits any more), so a timestamp returning under new copy still
    // trips it.
    await expect(
      page
        .locator("[data-stockists-section]")
        .getByText(/\d{4}\s*[年/-]\s*\d{1,2}/),
    ).toHaveCount(0);
  });

  test("an addressed location links through its address, not a second outbound link", async ({
    page,
  }) => {
    await page.goto(`/brands/${seeded.slug}`, {
      waitUntil: "domcontentloaded",
    });

    // The row carries `url: confirmedStoreUrl` AND an address, so this asserts
    // the outbound link is suppressed because the address already links
    // through — not that it is absent for want of a URL. Asserted against the
    // href, which is what the reader follows: a label-only assertion would go
    // green on any copy change.
    const stockistRow = page
      .locator("[data-stockist-row]")
      .filter({ hasText: confirmedStoreName });
    const rowLink = stockistRow.getByRole("link");
    await expect(rowLink).toHaveCount(1);
    await expect(rowLink).toHaveAttribute("href", /google\.com\/maps/);
    await expect(rowLink).toContainText(confirmedStoreName);
    await expect(
      stockistRow.locator(`a[href="${confirmedStoreUrl}"]`),
    ).toHaveCount(0);
  });

  test("a submitted stockist stays out of the public list until it is approved", async ({
    userPage,
  }) => {
    test.setTimeout(BUDGET.TEST.MUTATION);
    await userPage.goto(`/brands/${seeded.slug}`, {
      waitUntil: "domcontentloaded",
    });

    const dialog = await openChannelCorrection(
      userPage,
      "實體通路",
      "提供實體通路",
    );
    await dialog
      .getByRole("textbox", { name: "實體通路名稱" })
      .fill(submittedStockistName);
    // Neither a sales-format picker nor a location-category picker: every
    // stockist is a physical place, and its category is the brand's.
    await expect(
      dialog.getByRole("combobox", { name: "販售方式" }),
    ).toHaveCount(0);
    await expect(
      dialog.getByRole("combobox", { name: "地點分類" }),
    ).toHaveCount(0);
    const region = dialog.getByRole("combobox", { name: "地區" });
    await expect(region).toBeVisible();
    await region.selectOption("taipei");
    await dialog
      .getByRole("textbox", { name: "網址" })
      .fill(submittedStockistUrl);
    await dialog.getByRole("button", { name: "送出", exact: true }).click();
    // The submit still queues behind the like-button action, so give it 30s.
    // Matched on the clause that carries the promise — the submission is
    // reviewed BEFORE it appears — rather than on the whole sentence, because
    // that clause is what the rest of this test then verifies.
    await expect(dialog.getByText("先經過我們確認")).toBeVisible({
      timeout: BUDGET.GATED_UI,
    });
    await dialog.getByRole("button", { name: "關閉", exact: true }).click();

    // The row is written, but a community submission is a stranger's claim about
    // a shop until an admin approves it in /admin/stockists (DEV-1513). So the
    // public list must NOT grow: the submission named 台北市, so that is the
    // group whose count must not move, and the submitted name must appear
    // nowhere in the section.
    //
    // Not wrapped in `toPass`: the assertion is that a value did NOT change, and
    // retrying that would go green on the very first request no matter what the
    // write did. One reload, after the success toast, is the honest check.
    await userPage.reload({ waitUntil: "domcontentloaded" });
    await expect(
      userPage
        .locator('[data-stockist-kind="taipei"]')
        .getByText("1 家", { exact: true }),
    ).toBeVisible();
    await expect(
      userPage
        .locator("[data-stockists-section]")
        .getByText(submittedStockistName),
    ).toHaveCount(0);
  });

  test("a brand with no stockists renders no locations surface", async ({
    page,
  }) => {
    await page.goto(`/brands/${emptySeeded.slug}`, {
      waitUntil: "domcontentloaded",
    });

    await expect(page.locator("[data-stockists-section]")).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "實體通路", level: 3 }),
    ).toHaveCount(0);
  });
});
