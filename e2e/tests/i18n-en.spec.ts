import { test, expect } from "@playwright/test";
import { load } from "cheerio";

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
  test("/en declares the English locale in the initial HTTP document", async ({
    request,
  }) => {
    const response = await request.get("/en");

    expect(response.status()).toBe(200);
    const document = renderedDocument(await response.text());
    expect(document.lang).toBe("en");
  });

  test("/en/brands/djulis server-renders English chrome and taxonomy", async ({
    request,
  }) => {
    const response = await request.get("/en/brands/djulis");

    expect(response.status()).toBe(200);
    const document = renderedDocument(await response.text());
    expect(document.lang).toBe("en");

    for (const text of ["About Formoria", "Recommend a Brand"]) {
      expect(document.headerText).toContain(text);
    }
    // Only ontology-stable strings belong here: page chrome and the taxonomy
    // CATEGORY. Brand-level product tags must never be pinned — curation
    // rewrites them as a normal outcome, and djulis's tags legitimately moved
    // from 'Snacks' to 'Cereal Bars'/'Cookies & Rice Crackers' during the
    // 2026-08-03 re-curation, failing this spec on a data change rather than a
    // localisation regression. `Food & Beverage` comes from the ontology, so it
    // covers taxonomy localisation without depending on one brand's data.
    for (const text of [
      "Brands",
      "Visit Website",
      "Brand information",
      "Location",
      "Founded",
      "Category",
      "Price",
      "Product categories",
      "Food & Beverage",
    ]) {
      expect(document.mainText).toContain(text);
    }
    for (const text of [
      "品牌目錄",
      "前往官網",
      "品牌資訊",
      "地點",
      "創立年份",
      "類別",
      "價格區間",
      "產品類別",
      "食品飲料",
    ]) {
      expect(document.mainText).not.toContain(text);
    }
  });

  test("/brands/djulis server-renders Traditional Chinese chrome and taxonomy", async ({
    request,
  }) => {
    const response = await request.get("/brands/djulis");

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
      "地點",
      "創立年份",
      "類別",
      "價格區間",
      "產品類別",
      "食品飲料",
    ]) {
      expect(document.mainText).toContain(text);
    }
    for (const text of [
      "Brand Directory",
      "Visit Website",
      "Brand information",
      "Location",
      "Founded",
      "Category",
      "Product categories",
      "Food & Beverage",
    ]) {
      expect(document.mainText).not.toContain(text);
    }
  });

  test("/en/contributions preserves the localized return path when signed out", async ({
    request,
  }) => {
    const response = await request.get("/en/contributions", {
      maxRedirects: 0,
    });

    expect(response.status()).toBe(307);
    const location = new URL(response.headers().location, "http://localhost");
    expect(location.pathname).toBe("/en/auth/sign-in");
    expect(location.searchParams.get("next")).toBe("/en/contributions");
  });

  test("/en returns 200 and shows English header chrome", async ({ page }) => {
    const response = await page.goto("/en");
    expect(response?.status()).toBe(200);
    // Header renders "Recommend a Brand" in English; html[lang] is "en"
    await expect(
      page.locator("header").getByRole("link", { name: "Recommend a Brand" }),
    ).toBeVisible({ timeout: 10_000 });
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
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });

  test("LocaleSwitcher persists Traditional Chinese and returns to the equivalent route", async ({
    page,
  }) => {
    await page.goto("/en/brands");

    const switcherBtn = page
      .getByRole("banner")
      .getByRole("button", { name: "Switch language" });
    await expect(switcherBtn).toBeVisible({ timeout: 10_000 });
    await switcherBtn.click();

    const zhItem = page.getByRole("menuitem", { name: "Traditional Chinese" });
    await expect(zhItem).toBeVisible({ timeout: 5_000 });
    await zhItem.click();

    await expect(page).toHaveURL(/\/brands$/, { timeout: 10_000 });
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
    await expect(switcherBtn).toBeVisible({ timeout: 10_000 });
    await switcherBtn.click();

    const enItem = page.getByRole("menuitem", { name: "English" });
    await expect(enItem).toBeVisible({ timeout: 5_000 });
    await enItem.click();

    await expect(page).toHaveURL(/\/en\/brands/, { timeout: 10_000 });
  });

  test("LocaleSwitcher preserves repeated and encoded query parameters", async ({
    page,
  }) => {
    const search = "?category=food-drink&tag=rice%2Fgrains&tag=gift%20boxes";
    await page.goto(`/brands${search}`);

    const switcherBtn = page
      .getByRole("banner")
      .getByRole("button", { name: "切換語言" });
    await expect(switcherBtn).toBeVisible({ timeout: 10_000 });
    await switcherBtn.click();
    await page.getByRole("menuitem", { name: "English" }).click();

    await expect(page).toHaveURL(
      (url) =>
        url.pathname === "/en/brands" &&
        url.searchParams.get("category") === "food-drink" &&
        url.searchParams.getAll("tag").join("|") === "rice/grains|gift boxes",
      { timeout: 10_000 },
    );
  });

  test("/en/brands brand cards link to /en/brands/[slug]", async ({ page }) => {
    await page.goto("/en/brands");
    const firstBrand = page
      .locator('main [role="list"] article a[href*="/brands/"]')
      .first();
    const hasBrand = await firstBrand
      .isVisible({ timeout: 10_000 })
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
      timeout: 10_000,
    });
  });

  test("/en/brands/[slug] renders English chrome, not the default locale", async ({
    page,
  }) => {
    await page.goto("/en/brands");
    const firstBrand = page
      .locator('main [role="list"] article a[href*="/brands/"]')
      .first();
    const hasBrand = await firstBrand
      .isVisible({ timeout: 10_000 })
      .catch(() => false);
    if (!hasBrand) {
      test.skip(true, "No brands seeded — skipping brand detail locale check");
      return;
    }
    const href = await firstBrand.getAttribute("href");
    expect(href).toBeTruthy();
    await page.goto(href!);
    await expect(
      page.getByRole("link", { name: "About Formoria" }),
    ).toBeVisible({
      timeout: 10_000,
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
      timeout: 10_000,
    });
    await expect(page.getByText("關於 Formoria")).toHaveCount(0);
  });

  test("switching to EN via the switcher updates chrome + client components without refresh", async ({
    page,
  }) => {
    // The homepage has the largest client tree in this suite. Wait for its
    // hydration requests to settle before clicking a trigger that is present in
    // the server HTML but only becomes interactive on the client.
    await page.goto("/", { waitUntil: "networkidle" });
    const switcherBtn = page
      .getByRole("banner")
      .getByRole("button", { name: "切換語言" });
    await expect(switcherBtn).toBeVisible({ timeout: 10_000 });
    await switcherBtn.click();
    const enItem = page.getByRole("menuitem", { name: "English" });
    await expect(enItem).toBeVisible({ timeout: 10_000 });
    await enItem.click();
    await expect(page).toHaveURL(/\/en/, { timeout: 10_000 });
    // After switching: header submit link should be in English
    await expect(
      page.locator("header").getByRole("link", { name: "Recommend a Brand" }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });
});
