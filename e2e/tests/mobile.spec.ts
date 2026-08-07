import { test, expect } from "@playwright/test";

// These tests run under the 'mobile' project (375px viewport via Pixel 5 device)
test.describe("Mobile responsive", () => {
  const pages = ["/", "/brands", "/submit"];

  for (const url of pages) {
    test(`${url} has no horizontal overflow at 375px`, async ({ page }) => {
      await page.goto(url);
      await page.waitForLoadState("domcontentloaded");
      await expect(page.getByRole('banner')).toBeVisible();
      const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
      const viewportWidth = page.viewportSize()?.width ?? 375;
      expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 5); // 5px tolerance
    });
  }

  test("brands directory renders brand cards on mobile", async ({ page }) => {
    await page.goto("/brands");
    const firstCard = page
      .locator('main [role="list"] [role="listitem"] article')
      .first();
    await expect(firstCard).toBeVisible({ timeout: 10_000 });
    await expect(firstCard.getByRole("link")).toHaveAttribute(
      "href",
      /\/brands\//,
    );
  });

  test("navigation is accessible (hamburger or nav visible)", async ({
    page,
  }) => {
    await page.goto("/");
    const hamburger = page.getByRole("button", {
      name: "Open menu",
      exact: true,
    });
    const nav = page.getByRole('banner').getByRole('navigation');
    if (await hamburger.isVisible().catch(() => false)) {
      await expect(hamburger).toBeVisible({ timeout: 5_000 });
      return;
    }
    await expect(nav).toBeVisible({ timeout: 5_000 });
  });

  test("sign-in page has no horizontal overflow at 375px", async ({ page }) => {
    // Tests auth page mobile layout — /admin redirects here for unauthenticated users.
    // The auth layout has no <header>; use <main> or the form heading as a load signal.
    await page.goto("/auth/sign-in");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByRole("heading").first()).toBeVisible({
      timeout: 5_000,
    });
    const body = await page.evaluate(() => document.body.scrollWidth);
    expect(body).toBeLessThanOrEqual(page.viewportSize()!.width + 5);
  });

  test("Creative Expo mobile panels retain filters through brand navigation", async ({
    page,
  }) => {
    // Catches the user-facing mobile explorer contract: panel controls must
    // expose their pressed state without claiming an incomplete tab pattern.
    const response = await page.goto("/events/2026-taiwan-creative-expo");
    if (response?.status() === 503) {
      test.skip(
        true,
        "PREVIEW_MODE blocks the public event route in this environment.",
      );
    }

    const explorer = page.getByRole("region", {
      name: "參展品牌",
      exact: true,
    });
    const panelGroup = explorer.getByRole("group", {
      name: "文博會探索器面板",
    });
    const mapTab = panelGroup.getByRole("button", { name: "地圖" });
    const listTab = panelGroup.getByRole("button", { name: "品牌名單" });
    await expect(mapTab).toHaveAttribute("aria-pressed", "true");

    const map = explorer.getByRole("region", { name: "互動平面圖" });
    const k2MapZone = map.getByRole("button", { name: "K2: 工藝與文化永續" });
    await k2MapZone.click();
    await expect(k2MapZone).toHaveAttribute("aria-pressed", "true");

    await listTab.click();
    await expect(listTab).toHaveAttribute("aria-pressed", "true");
    const jewelry = explorer.getByRole("button", {
      name: "飾品珠寶",
      exact: true,
    });
    await jewelry.click();
    const search = explorer.getByRole("searchbox", {
      name: "搜尋官方名稱、Formoria 品牌名稱、羅馬拼音或攤位編號",
    });
    await search.fill("K2-022");
    const result = explorer.getByRole("link", { name: "鉐葉 SHIYE" });
    await expect(result).toBeVisible();
    await expect(explorer.getByRole("status")).toContainText("共 1 個品牌");

    await mapTab.click();
    await expect(k2MapZone).toHaveAttribute("aria-pressed", "true");
    await listTab.click();
    await expect(jewelry).toHaveAttribute("aria-pressed", "true");
    await expect(search).toHaveValue("K2-022");
    await expect(result).toBeVisible();

    await result.click();
    await expect(page).toHaveURL(/\/brands\/shiye$/);
    await page.goBack();
    await expect(page).toHaveURL(
      /\/events\/2026-taiwan-creative-expo\?zone=K2&category=/,
    );
    await expect(mapTab).toHaveAttribute("aria-pressed", "true");
    await listTab.click();
    await expect(jewelry).toHaveAttribute("aria-pressed", "true");
    await expect(search).toHaveValue("");
    await search.fill("K2-022");
    await expect(result).toBeVisible();
  });
});
