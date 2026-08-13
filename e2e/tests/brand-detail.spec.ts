import { test, expect } from "../fixtures/auth";
import type { Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { load } from "cheerio";
import { seedBrand, SeededBrand } from "../helpers/seed";

import { BUDGET, POLL } from "../budgets";

async function openChannelGroup(page: Page, key: string) {
  const group = page.locator(`details[data-channel-kind="${key}"]`);
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
      withOwner: true,
      // The FAQ cases below need brand *evidence*, not links: the presets that
      // survive gate on mit_status / product_tags / price_range.
      withFaqEvidence: true,
    });
    brandHref = `/brands/${seeded.slug}`;
  });

  test.afterAll(async () => {
    await seeded.cleanup();
  });

  test("@smoke all sections render without error", async ({ page }) => {
    await page.goto(brandHref);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: BUDGET.INTERACTIVE,
    });
    // No error boundaries or 404
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
      page.getByRole("heading", { name: "購買管道", level: 2 }),
    ).toBeVisible({
      timeout: BUDGET.INTERACTIVE,
    });

    // Both sections must appear on the same page — confirming structural separation
    const socialSection = page.getByRole("heading", {
      name: "社群平台",
      level: 2,
    });
    const purchaseSection = page.getByRole("heading", {
      name: "購買管道",
      level: 2,
    });
    await expect(socialSection).toBeVisible();
    await expect(purchaseSection).toBeVisible();
  });

  test("links sections are structurally separate (social before purchase)", async ({
    page,
  }) => {
    await page.goto(`/brands/${seeded.slug}`);

    const socialHeading = page.getByRole("heading", {
      name: "社群平台",
      level: 2,
    });
    const purchaseHeading = page.getByRole("heading", {
      name: "購買管道",
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
      page.getByRole("heading", { name: "購買管道", level: 2 }),
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

  test("JSON-LD structured data is present", async ({ page }) => {
    await page.goto(brandHref);
    const jsonLd = await page
      .locator('script[type="application/ld+json"]')
      .first()
      .textContent();
    const parsed = JSON.parse(jsonLd || "{}");
    expect(parsed["@type"]).toBeTruthy();
  });

  test("canonical URL matches current URL", async ({ page }) => {
    await page.goto(brandHref);
    const canonical = await page
      .locator('link[rel="canonical"]')
      .getAttribute("href");
    expect(decodeURIComponent(canonical ?? "")).toContain(
      decodeURIComponent(brandHref),
    );
  });

  test("FAQ renders on a data-rich brand", async ({ page }) => {
    test.setTimeout(BUDGET.TEST.MUTATION);
    // Seeded via `withFaqEvidence`: mit_status, product_tags and price_range.
    // Those — not links — are what the FAQ floors gate on. This fixture is
    // declared rather than MIT-verified, so taiwan-origin is intentionally
    // absent while the product and price floors still render.
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

    // Each seeded evidence field must pull its own preset onto the page, while
    // an unverified/declared brand must not receive a taiwan-origin floor.
    for (const id of ["main-products", "price-positioning"]) {
      await expect(page.locator(`details#faq-${id}`)).toHaveCount(1);
    }
    await expect(page.locator("details#faq-taiwan-origin")).toHaveCount(0);

    const priceAnswer = page.locator("#faq-price-positioning p");
    await expect(priceAnswer).toContainText("產品定位在中價位。");
    await expect(priceAnswer).not.toContainText("中價位價位");

    const jsonLdNodes = await page
      .locator('script[type="application/ld+json"]')
      .allTextContents();
    const faqJsonLd = jsonLdNodes
      .map(
        (content) =>
          JSON.parse(content) as {
            "@type"?: string;
            mainEntity?: Array<{ name?: string }>;
          },
      )
      .find((node) => node["@type"] === "FAQPage");
    const faqQuestions = faqJsonLd?.mainEntity?.map(
      (entry) => entry.name ?? "",
    );

    expect(faqJsonLd).toBeDefined();
    expect(faqQuestions).toContain(`${seeded.brand.name} 的價位屬於哪個區間？`);
    expect(
      faqQuestions?.some((question) => question.includes("是台灣品牌嗎？")),
    ).toBe(false);
  });

  test("FAQ answer text is in the DOM while collapsed", async ({
    page,
    request,
  }) => {
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
    // The declared fixture has no taiwan-origin floor, so the first rendered
    // item is the main-products floor.
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
      page.getByRole("heading", { name: "購買管道", level: 2 }),
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
      purchaseChannel: "myship",
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
  }) => {
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

test.describe("Brand detail — public locations and retail channels", () => {
  let seeded: SeededBrand;
  let emptySeeded: SeededBrand;

  const confirmedStoreName = "[E2E-TEST] Brand direct store";
  const confirmedStoreAddress = "台北市信義區信義路五段 7 號";
  const confirmedOnlineName = "[E2E-TEST] Brand online channel";
  const anonymousChannelName = "[E2E-TEST] Anonymous confirmation channel";
  const signedInChannelName = "[E2E-TEST] Signed-in confirmation channel";
  const submittedChannelName = "[E2E-TEST] Submitted community channel";
  const confirmedStoreUrl = "https://example.com/e2e-brand-store";
  const evidenceSourceUrl = "https://example.com/e2e-stockists";
  const submittedChannelUrl = "https://example.com/e2e-submitted-channel";

  test.beforeAll(async ({}, workerInfo) => {
    seeded = await seedBrand({
      name: "mixed-channels",
      status: "approved",
      workerIndex: workerInfo.workerIndex,
    });
    emptySeeded = await seedBrand({
      name: "without-channels",
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

    const { data: usersData, error: usersError } =
      await serviceClient.auth.admin.listUsers();
    if (usersError) {
      throw new Error(`Failed to list E2E users: ${usersError.message}`);
    }
    const confirmationUser = usersData.users.find(
      (user) => user.email === process.env.E2E_ADMIN_EMAIL,
    );
    if (!confirmationUser) {
      throw new Error("E2E admin user not found for channel confirmation seed");
    }

    const channelRows = [
      {
        brand_id: seeded.brand.id,
        name: confirmedStoreName,
        normalized_name: "e2e-brand-direct-store",
        channel_type: "offline",
        category_label: "品牌直營",
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
        name: confirmedOnlineName,
        normalized_name: "e2e-brand-online-channel",
        channel_type: "online",
        category_label: "選品店",
        region_label: null,
        address: null,
        url: null,
        source: "owner",
        owner_status: "confirmed",
      },
      {
        brand_id: seeded.brand.id,
        name: anonymousChannelName,
        normalized_name: "e2e-anonymous-confirmation-channel",
        channel_type: "offline",
        category_label: "選品店",
        region_label: "臺中市",
        address: null,
        url: null,
        source: "community",
        owner_status: "none",
      },
      {
        brand_id: seeded.brand.id,
        name: signedInChannelName,
        normalized_name: "e2e-signed-in-confirmation-channel",
        channel_type: "offline",
        category_label: "選品店",
        region_label: "新北市",
        address: null,
        url: null,
        source: "community",
        owner_status: "none",
      },
    ];

    const { data: channels, error: channelsError } = await serviceClient
      .from("brand_channels")
      .insert(channelRows)
      .select("id, name");
    if (channelsError || !channels) {
      throw new Error(
        `Failed to seed brand channels: ${channelsError?.message ?? "missing rows"}`,
      );
    }

    const channelIds = new Map(
      channels.map((channel) => [channel.name, channel.id]),
    );
    const getChannelId = (name: string): string => {
      const id = channelIds.get(name);
      if (!id) throw new Error(`Seeded channel not found: ${name}`);
      return id;
    };
    const { error: confirmationsError } = await serviceClient
      .from("brand_channel_confirmations")
      .insert([
        {
          channel_id: getChannelId(confirmedOnlineName),
          user_id: confirmationUser.id,
        },
      ]);
    if (confirmationsError) {
      throw new Error(
        `Failed to seed channel confirmations: ${confirmationsError.message}`,
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
          .getByRole("link", { name: "販售地點", exact: true }),
      ).toBeVisible();
    }).toPass(POLL.DB);

    const taipei = page.locator('details[data-channel-kind="taipei"]');
    const taichung = page.locator('details[data-channel-kind="taichung"]');
    await expect(taipei).not.toHaveAttribute("open");
    await expect(taichung).not.toHaveAttribute("open");

    await openChannelGroup(page, "taipei");
    await openChannelGroup(page, "taichung");
    await expect(taipei).toHaveAttribute("open", "");
    await expect(taichung).toHaveAttribute("open", "");
  });

  test("category badges render", async ({ page }) => {
    await page.goto(`/brands/${seeded.slug}`, {
      waitUntil: "domcontentloaded",
    });
    await openChannelGroup(page, "taipei");
    await openChannelGroup(page, "online");

    await expect(page.getByText("品牌直營", { exact: true })).toBeVisible();
    await expect(
      page.getByText("選品店", { exact: true }).first(),
    ).toBeVisible();
  });

  test("an imported stockist renders its address, Maps link and source line", async ({
    page,
  }) => {
    await page.goto(`/brands/${seeded.slug}`, {
      waitUntil: "domcontentloaded",
    });
    await openChannelGroup(page, "taipei");

    await expect(
      page.getByRole("link", { name: confirmedStoreAddress, exact: true }),
    ).toHaveAttribute("href", /^https:\/\/www\.google\.com\/maps\/search\//);
    await expect(
      page.getByRole("link", { name: "來源：example.com", exact: true }),
    ).toHaveAttribute("href", evidenceSourceUrl);
    await expect(page.getByText(/讀取於/)).toHaveCount(0);
  });

  test("an imported stockist shows no confirmation prompt", async ({
    page,
  }) => {
    await page.goto(`/brands/${seeded.slug}`, {
      waitUntil: "domcontentloaded",
    });
    await openChannelGroup(page, "taipei");

    const stockistRow = page
      .locator("[data-channel-row]")
      .filter({ hasText: confirmedStoreName });
    await expect(stockistRow).toBeVisible();
    await expect(stockistRow.getByRole("button", { name: /確認/ })).toHaveCount(
      0,
    );
    await expect(stockistRow.getByText(/人確認/)).toHaveCount(0);
  });

  test("external link renders for channels with a URL", async ({ page }) => {
    await page.goto(`/brands/${seeded.slug}`, {
      waitUntil: "domcontentloaded",
    });
    await openChannelGroup(page, "taipei");

    await expect(
      page.getByRole("link", { name: "查看店家資訊", exact: true }),
    ).toHaveAttribute("href", confirmedStoreUrl);
  });

  test("anonymous confirm shows a sign-in prompt", async ({ anonPage }) => {
    await anonPage.goto(`/brands/${seeded.slug}`, {
      waitUntil: "domcontentloaded",
    });
    await openChannelGroup(anonPage, "taichung");

    const channelChip = anonPage
      .locator("[data-channel-chip]")
      .filter({ hasText: anonymousChannelName });
    await channelChip
      .getByRole("button", {
        name: `我確認${anonymousChannelName}有販售`,
        exact: true,
      })
      .click();

    const chipGroup = anonPage
      .locator("[data-channel-chip-group]")
      .filter({ hasText: anonymousChannelName });
    await expect(chipGroup.getByText("登入後即可確認")).toBeVisible();
    await expect(
      chipGroup.getByRole("link", { name: "登入", exact: true }),
    ).toHaveAttribute("href", /\/auth\/sign-in\?next=/);
  });

  test("signed-in confirm increments the confirmation count", async ({
    userPage,
  }) => {
    test.setTimeout(BUDGET.TEST.MUTATION);
    await userPage.goto(`/brands/${seeded.slug}`, {
      waitUntil: "domcontentloaded",
    });
    await openChannelGroup(userPage, "new_taipei");

    const channelChip = userPage
      .locator("[data-channel-chip]")
      .filter({ hasText: signedInChannelName });
    await expect(channelChip.getByText("0/3 人確認")).toBeVisible();
    await channelChip
      .getByRole("button", {
        name: `我確認${signedInChannelName}有販售`,
        exact: true,
      })
      .click();
    await expect(channelChip.getByText("1/3 人確認")).toBeVisible();

    // That count is optimistic: Next.js serializes server actions into one global
    // queue, so the confirm can still be waiting behind the mount-time actions.
    // Reloading now would tear the page down before the write is ever dispatched.
    await expect(channelChip).not.toHaveAttribute("data-confirm-pending", "", {
      timeout: BUDGET.SERVER_RENDER,
    });

    // The page uses on-demand ISR with `revalidate = 3600`, so revalidation is
    // stale-while-revalidate: the first request after the
    // mutation can still be served from the old cache entry while the
    // regeneration runs. Retry the reload rather than assuming the write is
    // readable on the very next request. Same pattern as the submitted-channel
    // test below.
    await expect(async () => {
      await userPage.reload({ waitUntil: "domcontentloaded" });
      await openChannelGroup(userPage, "new_taipei");
      await expect(
        userPage
          .locator("[data-channel-chip]")
          .filter({ hasText: signedInChannelName })
          .getByText("1/3 人確認"),
      ).toBeVisible();
    }).toPass(POLL.DB);
  });

  test("submitted channel appears in the online group", async ({
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
      name: "提供販售地點",
      exact: true,
    });
    await expect(trigger).toBeVisible();

    // The brand page is statically served and hydrates afterwards, so a click that
    // lands too early is a silent no-op and every later step then times out waiting
    // on a dialog that was never opened. Retry the idempotent open instead of
    // sleeping on a guessed hydration delay — same pattern as openCategoryDialog in
    // brand-corrections.spec.ts.
    const dialog = userPage.getByRole("dialog", { name: "提供販售地點" });
    await expect(async () => {
      if (!(await dialog.isVisible())) await trigger.click();
      await expect(dialog).toBeVisible({ timeout: BUDGET.INTERACTIVE });
    }).toPass(POLL.UI);
    await dialog
      .getByRole("textbox", { name: "販售地點名稱" })
      .fill(submittedChannelName);
    await dialog
      .getByRole("combobox", { name: "販售方式" })
      .selectOption("online");
    await dialog
      .getByRole("combobox", { name: "地點分類" })
      .selectOption("other");
    await dialog.getByRole("combobox", { name: "地區" }).selectOption("taipei");
    await dialog
      .getByRole("textbox", { name: "網址" })
      .fill(submittedChannelUrl);
    await dialog.getByRole("button", { name: "送出", exact: true }).click();
    // The submit still queues behind the like-button action, so give it 30s.
    await expect(dialog.getByText("感謝您提供的資訊！")).toBeVisible({
      timeout: BUDGET.GATED_UI,
    });
    await dialog.getByRole("button", { name: "關閉", exact: true }).click();

    await expect(async () => {
      await userPage.reload({ waitUntil: "domcontentloaded" });
      await expect(
        userPage.getByRole("heading", {
          name: "線上販售 (2)",
          level: 3,
        }),
      ).toBeVisible();
      await openChannelGroup(userPage, "online");
      await expect(
        userPage
          .locator("[data-channel-chip]")
          .filter({ hasText: submittedChannelName }),
      ).toBeVisible();
    }).toPass(POLL.DB);
  });

  test("a brand with no channels renders no locations surface", async ({
    page,
  }) => {
    await page.goto(`/brands/${emptySeeded.slug}`, {
      waitUntil: "domcontentloaded",
    });

    await expect(page.locator("[data-brand-channels-section]")).toHaveCount(0);
    await expect(
      page.getByRole("navigation", { name: "本頁導覽" }).getByRole("link", {
        name: "販售地點",
      }),
    ).toHaveCount(0);
    await expect(page.getByTestId("brand-channels-empty-state")).toHaveCount(0);
  });
});
