import { test, expect } from "@playwright/test";

// These tests run under the 'mobile' project (375px viewport via Pixel 5 device)
test.describe("Mobile responsive", () => {
  // The expo route is here because its exhibitor rows put a booth code, a name
  // and an outbound button on one line at 375px -- the densest row on the site,
  // and the most likely place for a width regression to land.
  const pages = [
    "/",
    "/brands",
    "/submit",
    "/events/2026-taiwan-creative-expo",
  ];

  for (const url of pages) {
    test(`${url} has no horizontal overflow at 375px`, async ({ page }) => {
      const response = await page.goto(url);
      if (response?.status() === 503) {
        test.skip(
          true,
          "PREVIEW_MODE blocks this public route in this environment.",
        );
      }
      await page.waitForLoadState("domcontentloaded");
      await expect(page.getByRole("banner")).toBeVisible();
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
    const nav = page.getByRole("banner").getByRole("navigation");
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

  test("Creative Expo mobile exhibitor list retains its zone through brand navigation", async ({
    page,
  }) => {
    // Catches the user-facing mobile contract: at 375px the zone chips and the
    // search box are the only filters, and a round trip through a brand page
    // has to bring the reader back to the same slice of the hall.
    const response = await page.goto("/events/2026-taiwan-creative-expo");
    if (response?.status() === 503) {
      test.skip(
        true,
        "PREVIEW_MODE blocks the public event route in this environment.",
      );
    }

    const explorer = page.getByRole("region", { name: "全部參展單位" });
    // The zone code leads the accessible name — it is what ties the chip to
    // the `K2-###` booth numbers on the floor plan and in every row.
    const k2Chip = explorer.getByRole("button", {
      name: /^K2 工藝與文化永續 \d+$/,
    });
    await k2Chip.click();
    await expect(k2Chip).toHaveAttribute("aria-pressed", "true");
    await expect(page).toHaveURL(/\?zone=K2$/);

    const search = explorer.getByRole("searchbox", {
      name: "搜尋參展單位名稱、羅馬拼音或攤位編號",
    });
    await search.fill("K2-022");
    const result = explorer.getByRole("link", {
      name: "鉐葉 SHIYE",
      exact: true,
    });
    await expect(result).toBeVisible();
    await expect(explorer.getByRole("status")).toContainText("共 1 個參展單位");

    await result.click();
    await expect(page).toHaveURL(/\/brands\/shiye$/);
    await page.goBack();
    // Only `zone` and `page` are mirrored into the URL, so the chip comes back
    // and the typed query does not -- the search text is deliberately never put
    // in a shareable link.
    await expect(page).toHaveURL(
      /\/events\/2026-taiwan-creative-expo\?zone=K2$/,
    );
    await expect(k2Chip).toHaveAttribute("aria-pressed", "true");
    await expect(search).toHaveValue("");
    await search.fill("K2-022");
    await expect(result).toBeVisible();
  });
});
