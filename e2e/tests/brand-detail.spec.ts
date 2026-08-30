import { test, expect } from "../fixtures/auth";
import type { Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { load } from "cheerio";
import { getServiceClient, seedBrand, SeededBrand } from "../helpers/seed";
import { isLocalTarget } from "../helpers/target";

import { BUDGET, POLL } from "../budgets";

async function openStockistGroup(page: Page, key: string) {
  const group = page.locator(`details[data-stockist-kind="${key}"]`);
  await expect(group).toBeVisible();
  if ((await group.getAttribute("open")) === null) {
    await group.locator("summary").click();
  }
  await expect(group).toHaveAttribute("open", "");
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
    brandHref = `/brands/${seeded.slug}`;
  });

  test.afterAll(async () => {
    await seeded.cleanup();
  });

  test("@smoke brand information uses final category and subcategory copy in both locales", async ({
    page,
  }) => {
    await page.goto(brandHref);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: BUDGET.INTERACTIVE,
    });
    const zhBrandInfo = page.getByRole("region", { name: "品牌資訊" });
    await expect(
      zhBrandInfo.getByText("品牌類別", { exact: true }),
    ).toBeVisible();
    await expect(
      zhBrandInfo.getByText("商品子類別", { exact: true }),
    ).toBeVisible();

    await page.goto(`/en/brands/${seeded.slug}`);
    const enBrandInfo = page.getByRole("region", { name: "Brand information" });
    await expect(
      enBrandInfo.getByText("Brand category", { exact: true }),
    ).toBeVisible();
    await expect(
      enBrandInfo.getByText("Product subcategory", { exact: true }),
    ).toBeVisible();

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

    // Verify the purchase section heading is visible
    await expect(
      page.getByRole("heading", { name: "線上購買", level: 2 }),
    ).toBeVisible({
      timeout: BUDGET.INTERACTIVE,
    });
  });

  // Ordering is a separate failure from presence, so it is a separate test: a
  // merged case would hide the ordering result the moment a heading is missing
  // (see commit 4a4fc7a8). The extra `goto` is one cached load of an
  // already-seeded brand.
  test("links sections are structurally separate (social before purchase)", async ({
    page,
  }) => {
    await page.goto(`/brands/${seeded.slug}`);

    const socialHeading = page.getByRole("heading", {
      name: "社群平台",
      level: 2,
    });
    const purchaseHeading = page.getByRole("heading", {
      name: "線上購買",
      level: 2,
    });

    await expect(socialHeading).toBeVisible({ timeout: BUDGET.INTERACTIVE });
    await expect(purchaseHeading).toBeVisible();

    // Social section must appear before purchase section in document order
    const socialBox = await socialHeading.boundingBox();
    const purchaseBox = await purchaseHeading.boundingBox();
    expect(socialBox).not.toBeNull();
    expect(purchaseBox).not.toBeNull();
    expect(socialBox!.y).toBeLessThan(purchaseBox!.y);
  });

  test("tab nav click scrolls to correct section", async ({ page }) => {
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

    const websiteCta = page.getByRole("link", {
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

    // This journey targets the purchase section; locations has its own seeded
    // coverage below.
    await nav.getByRole("link", { name: "購買資訊" }).click();
    await expect(
      page.getByRole("heading", { name: "線上購買", level: 2 }),
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

    // At least one FAQ question row is present and visible. The rows are native
    // <details>/<summary> — there is no accordion-trigger slot to select on.
    const questions = page.locator('details[id^="faq-"] > summary');
    await expect(questions.first()).toBeVisible();

    // The seeded evidence field must pull its preset onto the page.
    await expect(page.locator("details#faq-main-products")).toHaveCount(1);

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

  test("FAQ answer text is in the DOM while collapsed", async ({
    page,
    request,
    baseURL,
  }) => {
    test.skip(
      !isLocalTarget(baseURL),
      "Cloudflare WAF challenges raw-HTTP Googlebot requests on a remote target",
    );
    test.setTimeout(BUDGET.TEST.MUTATION);
    // The whole point of DEV-1317: answers must be readable without opening
    // anything. Nothing here clicks — a test that expands first would pass
    // just as happily against JS-only, open-gated answer rendering.
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

    const firstItem = page.locator('details[id^="faq-"]').first();
    // The first rendered item is the main-products floor.
    await expect(firstItem).toHaveAttribute("id", "faq-main-products");
    await expect(firstItem.locator("p")).toContainText("代表產品包含");
    expect(
      await firstItem.evaluate((el) => (el as HTMLDetailsElement).open),
    ).toBe(false);

    // The literal acceptance criterion — "verifiable by curl". Asserting on the
    // rendered DOM alone would still pass if a client effect injected the text
    // after hydration, which is exactly the regression this guards against.
    const response = await request.get(`/brands/${seeded.slug}`, {
      headers: { "user-agent": "Googlebot" },
    });
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).toContain("代表產品包含");
    const $ = load(html);
    const serverItem = $('details[id^="faq-"]').first();
    expect(serverItem.attr("id")).toBe("faq-main-products");
    expect(serverItem.attr("open")).toBeUndefined();
    expect(serverItem.find("p").text()).toContain("代表產品包含");
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
        source_checked_at: new Date().toISOString(),
        product_description_zh:
          "PETG 懸臂結構搭配 Type-C 充電、觸控調光與 3000K 暖白光。",
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

  test("a pointer click does not pin the product caption open", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 929 });
    await page.goto(`/brands/${seeded!.slug}`);

    const tile = page.locator(`#product-${productKey}`);
    await expect(tile).toBeVisible({ timeout: BUDGET.INTERACTIVE });
    await tile.scrollIntoViewIfNeeded();
    const focusTarget = tile.locator('[tabindex="0"]');
    const image = focusTarget.locator(":scope > div").first();
    const caption = tile
      .getByRole("heading", { name: productName })
      .locator("..");

    await page.keyboard.press("Tab");
    await focusTarget.focus();
    await expect
      .poll(() => caption.evaluate((node) => getComputedStyle(node).opacity))
      .toBe("1");
    await focusTarget.evaluate((node) => (node as HTMLElement).blur());

    await image.click();
    await page.mouse.move(0, 0);
    await expect
      .poll(() => caption.evaluate((node) => getComputedStyle(node).opacity))
      .toBe("0");
  });
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

  test("social section is hidden and purchase section shows its empty prompt when brand has no links", async ({
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

    // Both link sections stay rendered when the brand has no links: every
    // destination shows as a dimmed, inert chip so the gap reads as "unknown"
    // rather than "not on that channel".
    await expect(
      page.getByRole("heading", { name: "社群平台", level: 2 }),
    ).toHaveCount(1);
    await expect(
      page.getByRole("heading", { name: "線上購買", level: 2 }),
    ).toHaveCount(1);

    for (const label of ["Instagram", "Threads", "Facebook", "品牌官網"]) {
      const chip = page.getByRole("button", {
        name: new RegExp(`^${label} — 尚無已知連結$`),
      });
      await expect(chip).toBeVisible();
      await expect(chip).toHaveAttribute("aria-disabled", "true");
    }

    await expect(
      page.getByRole("button", { name: "提供購買連結" }),
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

  test("myship renders as a live link while the website chip stays inert", async ({
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

    const websiteChip = page.getByRole("button", {
      name: /^品牌官網 — 尚無已知連結$/,
    });
    await expect(websiteChip).toBeVisible();
    await expect(websiteChip).toHaveAttribute("aria-disabled", "true");
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
    baseURL,
  }) => {
    test.skip(
      !isLocalTarget(baseURL),
      "Cloudflare WAF challenges raw-HTTP Googlebot requests on a remote target",
    );
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
        headers: { "user-agent": "Googlebot" },
      });
      expect(redirectResponse.status()).toBe(308);
      expect(redirectResponse.headers().location).toBe(target);

      const targetResponse = await request.get(target, {
        maxRedirects: 0,
        headers: { "user-agent": "Googlebot" },
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
    baseURL,
  }) => {
    test.skip(
      !isLocalTarget(baseURL),
      "Cloudflare WAF challenges raw-HTTP Googlebot requests on a remote target",
    );
    for (const source of [
      `/brands/${hiddenOldSlug}`,
      `/en/brands/${hiddenOldSlug}`,
    ]) {
      const response = await request.get(source, {
        maxRedirects: 0,
        headers: { "user-agent": "Googlebot" },
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

  test("location regions start collapsed and can remain open together", async ({
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
      await expect(
        page.getByRole("heading", { name: "臺北市 (1)", level: 3 }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", {
          name: "臺中市 (1)",
          level: 3,
        }),
      ).toBeVisible();
      await expect(
        page
          .getByRole("navigation", { name: "本頁導覽" })
          .getByRole("link", { name: "實體通路", exact: true }),
      ).toBeVisible();
    }).toPass(POLL.DB);

    const taipei = page.locator('details[data-stockist-kind="taipei"]');
    const taichung = page.locator('details[data-stockist-kind="taichung"]');
    await expect(taipei).not.toHaveAttribute("open");
    await expect(taichung).not.toHaveAttribute("open");

    await openStockistGroup(page, "taipei");
    await openStockistGroup(page, "taichung");
    await expect(taipei).toHaveAttribute("open", "");
    await expect(taichung).toHaveAttribute("open", "");
  });

  test("an imported stockist renders its address and Maps link", async ({
    page,
  }) => {
    await page.goto(`/brands/${seeded.slug}`, {
      waitUntil: "domcontentloaded",
    });
    await openStockistGroup(page, "taipei");

    await expect(
      page.getByRole("link", { name: confirmedStoreAddress, exact: true }),
    ).toHaveAttribute("href", /^https:\/\/www\.google\.com\/maps\/search\//);
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
    await openStockistGroup(page, "taipei");

    // The row carries `url: confirmedStoreUrl` AND an address, so this asserts
    // the outbound link is suppressed because the address already links
    // through — not that it is absent for want of a URL. Asserted against the
    // href, which is what the reader follows: a label-only assertion would go
    // green on any copy change.
    const stockistRow = page
      .locator("[data-stockist-row]")
      .filter({ hasText: confirmedStoreName });
    await expect(
      stockistRow.getByRole("link", {
        name: confirmedStoreAddress,
        exact: true,
      }),
    ).toHaveAttribute("href", /google\.com\/maps/);
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

    // The trigger ships in the server-rendered HTML, so a missing one is a real
    // regression rather than a timing problem. Assert it before the retry loop so
    // that case does not surface as an opaque "predicate timed out" on the dialog.
    const trigger = userPage.getByRole("button", {
      name: "提供實體通路",
      exact: true,
    });
    await expect(trigger).toBeVisible();

    // The brand page is statically served and hydrates afterwards, so a click that
    // lands too early is a silent no-op and every later step then times out waiting
    // on a dialog that was never opened. Retry the idempotent open instead of
    // sleeping on a guessed hydration delay — same pattern as openCategoryDialog in
    // brand-corrections.spec.ts.
    const dialog = userPage.getByRole("dialog", { name: "提供實體通路" });
    await expect(async () => {
      if (!(await dialog.isVisible())) await trigger.click();
      await expect(dialog).toBeVisible({ timeout: BUDGET.INTERACTIVE });
    }).toPass(POLL.UI);
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
    // public list must NOT grow: the submission named 臺北市, so that is the
    // group whose count must not move, and the submitted name must appear
    // nowhere in the section.
    //
    // Not wrapped in `toPass`: the assertion is that a value did NOT change, and
    // retrying that would go green on the very first request no matter what the
    // write did. One reload, after the success toast, is the honest check.
    await userPage.reload({ waitUntil: "domcontentloaded" });
    await expect(
      userPage.getByRole("heading", { name: "臺北市 (1)", level: 3 }),
    ).toBeVisible();
    await openStockistGroup(userPage, "taipei");
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
      page.getByRole("navigation", { name: "本頁導覽" }).getByRole("link", {
        name: "實體通路",
      }),
    ).toHaveCount(0);
  });
});
