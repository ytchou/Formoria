import { BUDGET } from "../budgets";
import { test, expect } from "@playwright/test";
import { load } from "cheerio";
import { seedBrand, type SeededBrand } from "../helpers/seed";

function renderedDocument(html: string) {
  const $ = load(html);
  $("script, style, noscript").remove();

  return {
    lang: $("html").attr("lang"),
    headerText: $("header").text().replace(/\s+/g, " ").trim(),
    mainText: $("main").text().replace(/\s+/g, " ").trim(),
  };
}

/**
 * i18n: English browse journey
 *
 * Routing convention (next-intl, localePrefix: 'as-needed'):
 *   zh-TW (default) — prefix-free: /brands
 *   en               — under /en:   /en/brands
 *
 * The header LocaleSwitcher renders as a globe icon button:
 *   button "Switch language" (en) | "切換語言" (zh-TW)
 *   → menu with persisted locale actions for Traditional Chinese and English
 */
test.describe("i18n English browse", () => {
  let seeded: SeededBrand;

  test.beforeAll(async ({}, workerInfo) => {
    seeded = await seedBrand({
      name: "i18n",
      workerIndex: workerInfo.workerIndex,
      withLinks: true,
      withFaqEvidence: true,
    });
  });

  test.afterAll(async () => {
    await seeded.cleanup();
  });

  test("/en declares the English locale in the initial HTTP document", async ({
    request,
  }) => {
    const response = await request.get("/en");

    expect(response.status()).toBe(200);
    const document = renderedDocument(await response.text());
    expect(document.lang).toBe("en");
  });

  test("/en/brands/<seeded> server-renders English chrome and taxonomy", async ({
    request,
  }) => {
    const response = await request.get(`/en/brands/${seeded.slug}`);

    expect(response.status()).toBe(200);
    const document = renderedDocument(await response.text());
    expect(document.lang).toBe("en");

    for (const text of ["About Formoria", "Recommend a Brand"]) {
      expect(document.headerText).toContain(text);
    }
    // Only fixture-backed copy and ontology-stable strings belong here. The
    // controlled brand cannot drift during a normal curation run.
    for (const text of [
      "Brands",
      "Visit Website",
      "Brand information",
      "Founded",
      "Brand category",
      "Product subcategory",
      "Home & Living",
    ]) {
      expect(document.mainText).toContain(text);
    }
    for (const text of [
      "品牌目錄",
      "前往官網",
      "品牌資訊",
      "創立年份",
      "品牌類別",
      "商品子類別",
      "居家生活",
    ]) {
      expect(document.mainText).not.toContain(text);
    }
  });

  test("/brands/<seeded> server-renders Traditional Chinese chrome and taxonomy", async ({
    request,
  }) => {
    const response = await request.get(`/brands/${seeded.slug}`);

    expect(response.status()).toBe(200);
    const document = renderedDocument(await response.text());
    expect(document.lang).toBe("zh-TW");

    for (const text of ["關於 Formoria", "推薦品牌"]) {
      expect(document.headerText).toContain(text);
    }
    // Ontology-stable strings only — see the note on the EN case above.
    for (const text of [
      "品牌目錄",
      "前往官網",
      "品牌資訊",
      "創立年份",
      "品牌類別",
      "商品子類別",
      "居家生活",
    ]) {
      expect(document.mainText).toContain(text);
    }
    for (const text of [
      "Brand Directory",
      "Visit Website",
      "Brand information",
      "Founded",
      "Brand category",
      "Product subcategory",
      "Home & Living",
    ]) {
      expect(document.mainText).not.toContain(text);
    }
  });

  // /en/contributions test removed: contributions route was deleted (PR #953).

  test("/en returns 200 and shows English header chrome", async ({ page }) => {
    const response = await page.goto("/en");
    expect(response?.status()).toBe(200);
    // Header renders "Recommend a Brand" in English; html[lang] is "en"
    await expect(
      page.locator("header").getByRole("link", { name: "Recommend a Brand" }),
    ).toBeVisible({ timeout: BUDGET.INTERACTIVE });
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });

  test("/en/brands returns 200 and shows English directory chrome", async ({
    page,
  }) => {
    const response = await page.goto("/en/brands");
    expect(response?.status()).toBe(200);
    // The directory page renders brands in a list or an empty-state message
    await expect(
      page
        .locator('main [role="list"] [role="listitem"]')
        .first()
        .or(page.locator("[data-empty]").first()),
    ).toBeVisible({ timeout: BUDGET.INTERACTIVE });
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });

  test("LocaleSwitcher persists Traditional Chinese on the equivalent category route", async ({
    page,
  }) => {
    await page.goto("/en/discover?category=home");

    const switcherBtn = page
      .getByRole("banner")
      .getByRole("button", { name: "Switch language" });
    await expect(switcherBtn).toBeVisible({ timeout: BUDGET.INTERACTIVE });
    await switcherBtn.click();

    const zhItem = page.getByRole("menuitem", { name: "Traditional Chinese" });
    await expect(zhItem).toBeVisible({ timeout: BUDGET.RENDERED });
    await zhItem.click();

    await expect(page).toHaveURL(
      (url) =>
        url.pathname === "/discover" &&
        url.searchParams.get("category") === "home",
      {
        timeout: BUDGET.INTERACTIVE,
      },
    );
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-TW");
    await expect
      .poll(
        async () =>
          (await page.context().cookies()).find(
            (cookie) => cookie.name === "NEXT_LOCALE",
          )?.value,
      )
      .toBe("zh-TW");
  });

  test('LocaleSwitcher "English" menuitem on /brands navigates to /en/brands', async ({
    page,
  }) => {
    await page.goto("/brands");

    const switcherBtn = page
      .getByRole("banner")
      .getByRole("button", { name: "切換語言" });
    await expect(switcherBtn).toBeVisible({ timeout: BUDGET.INTERACTIVE });
    await switcherBtn.click();

    const enItem = page.getByRole("menuitem", { name: "English" });
    await expect(enItem).toBeVisible({ timeout: BUDGET.RENDERED });
    await enItem.click();

    await expect(page).toHaveURL(/\/en\/brands/, {
      timeout: BUDGET.INTERACTIVE,
    });
  });

  test("LocaleSwitcher preserves repeated and encoded query parameters", async ({
    page,
  }) => {
    const search = "?category=food-drink&tag=rice%2Fgrains&tag=gift%20boxes";
    await page.goto(`/brands${search}`);

    const switcherBtn = page
      .getByRole("banner")
      .getByRole("button", { name: "切換語言" });
    await expect(switcherBtn).toBeVisible({ timeout: BUDGET.INTERACTIVE });
    await switcherBtn.click();
    await page.getByRole("menuitem", { name: "English" }).click();

    await expect(page).toHaveURL(
      (url) =>
        url.pathname === "/en/brands" &&
        url.searchParams.get("category") === "food-drink" &&
        url.searchParams.getAll("tag").join("|") === "rice/grains|gift boxes",
      { timeout: BUDGET.INTERACTIVE },
    );
  });

  test("/en/brands brand cards link to /en/brands/[slug]", async ({ page }) => {
    await page.goto("/en/brands");
    const firstBrand = page
      .locator('main [role="list"] article a[href*="/brands/"]')
      .first();
    const hasBrand = await firstBrand
      .isVisible({ timeout: BUDGET.INTERACTIVE })
      .catch(() => false);
    if (!hasBrand) {
      test.skip(
        true,
        "No brands seeded — skipping brand card navigation check",
      );
      return;
    }
    const href = await firstBrand.getAttribute("href");
    expect(href).toBeTruthy();
    expect(href).toContain("/en/brands/");
    await page.goto(href!);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: BUDGET.INTERACTIVE,
    });
  });

  test("/en/brands/[slug] renders English chrome, not the default locale", async ({
    page,
  }) => {
    await page.goto(`/en/brands/${seeded.slug}`);
    await expect(
      page.getByRole("link", { name: "About Formoria" }),
    ).toBeVisible({
      timeout: BUDGET.INTERACTIVE,
    });
    await expect(page.getByText("關於 Formoria")).toHaveCount(0);
  });

  // Every story is authored zh-TW. /en/stories now falls back to that zh-TW set and
  // /en/stories/[slug] serves the zh-TW document under a zh-TW canonical (covered in
  // e2e/tests/stories.spec.ts and e2e/tests/story-detail.spec.ts) — so story TITLES on
  // this hub are Chinese by design. The chrome around them is what must be English:
  // that is the signal that next-intl isn't falling back to the default locale.
  test("/en/stories renders English chrome, not the default locale", async ({
    page,
  }) => {
    await page.goto("/en/stories");
    await expect(
      page.getByRole("link", { name: "About Formoria" }),
    ).toBeVisible({
      timeout: BUDGET.INTERACTIVE,
    });
    await expect(page.getByText("關於 Formoria")).toHaveCount(0);
  });

  test("switching to EN via the switcher updates chrome + client components without refresh", async ({
    page,
  }) => {
    // `networkidle` on `/` alone outgrew the 30s CI default when DEV-1514
    // rebuilt the homepage — the wall now ships more image requests, and four
    // parallel workers share one origin. Measured at 17.3s serially against
    // deployed staging, so the failure was the budget, not the page: this is
    // the only test in the file that waits on idle rather than on an element.
    test.setTimeout(BUDGET.TEST.JOURNEY);

    // The homepage has the largest client tree in this suite. Wait for its
    // hydration requests to settle before clicking a trigger that is present in
    // the server HTML but only becomes interactive on the client.
    await page.goto("/", { waitUntil: "networkidle" });
    const switcherBtn = page
      .getByRole("banner")
      .getByRole("button", { name: "切換語言" });
    await expect(switcherBtn).toBeVisible({ timeout: BUDGET.INTERACTIVE });
    await switcherBtn.click();
    const enItem = page.getByRole("menuitem", { name: "English" });
    await expect(enItem).toBeVisible({ timeout: BUDGET.INTERACTIVE });
    await enItem.click();
    await expect(page).toHaveURL(/\/en/, { timeout: BUDGET.INTERACTIVE });
    // After switching: header submit link should be in English
    await expect(
      page.locator("header").getByRole("link", { name: "Recommend a Brand" }),
    ).toBeVisible({ timeout: BUDGET.INTERACTIVE });
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });
});
