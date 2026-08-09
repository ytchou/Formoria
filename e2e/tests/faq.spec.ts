import { test, expect } from "../fixtures/auth";

/**
 * FAQ page
 *
 * Journey: Anonymous visitor lands on /faq (zh-TW, the default locale path),
 * sees both section headings and all 13 expandable items; hash links scroll
 * the correct section into view; the #claim item auto-opens via the
 * OpenTargetDetails client component.
 *
 * The 品牌主專區 section collapsed to a single interest-collection item while
 * owner self-serve is gated off (DEV-1261). It keeps id="claim", so the
 * legacy /faq#claim deep link still lands on an answer — see the last test.
 *
 * Actor: anonPage (no authentication, no DB state)
 * Seed: none
 */
test.describe("FAQ page", () => {
  test("@smoke renders two section headings and exactly 13 details elements", async ({
    anonPage,
  }) => {
    // /faq is the zh-TW canonical URL (localePrefix: 'as-needed', defaultLocale: 'zh-TW')
    const resp = await anonPage.goto("/faq", { timeout: 30_000 });
    if (resp?.status() === 503) {
      test.skip(true, "PREVIEW_MODE active — skipping");
      return;
    }

    // Both section-level h2 headings must be present
    await expect(
      anonPage.getByRole("heading", { name: "一般問題", level: 2 }),
    ).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      anonPage.getByRole("heading", { name: "品牌主專區", level: 2 }),
    ).toBeVisible({
      timeout: 5_000,
    });

    // 12 general + 1 contact + 1 owner interest = 14 total <details> elements.
    // The general count tracks `generalItemKeys` in faq/page.tsx — adding an
    // entry there without updating this number is what turns this spec red.
    await expect(anonPage.locator("details")).toHaveCount(14, {
      timeout: 5_000,
    });
  });

  test("#for-owners anchor scrolls the section into viewport", async ({
    anonPage,
  }) => {
    const resp = await anonPage.goto("/faq#for-owners", { timeout: 30_000 });
    if (resp?.status() === 503) {
      test.skip(true, "PREVIEW_MODE active — skipping");
      return;
    }

    // The <section id="for-owners"> must be within the viewport after hash navigation
    await expect(anonPage.locator("#for-owners")).toBeInViewport({
      timeout: 10_000,
    });
  });

  test("#claim details auto-opens via OpenTargetDetails on hash navigation", async ({
    anonPage,
  }) => {
    const resp = await anonPage.goto("/faq#claim", { timeout: 30_000 });
    if (resp?.status() === 503) {
      test.skip(true, "PREVIEW_MODE active — skipping");
      return;
    }

    // OpenTargetDetails runs a useEffect that sets <details id="claim">.open = true.
    // Poll until hydration completes and the attribute is set.
    await expect(async () => {
      const isOpen = await anonPage.evaluate(() => {
        const el = document.getElementById("claim");
        return el ? el.open : false;
      });
      expect(isOpen).toBe(true);
    }).toPass({ timeout: 5_000 });
  });
});
