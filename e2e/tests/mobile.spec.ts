import { BUDGET } from "../budgets";
import { test, expect } from "@playwright/test";
import { resolveLinkedExhibitor } from "../utils/expo-explorer";

const CREATIVE_EXPO_URL = "/events/2026-taiwan-creative-expo";

// These tests run under the 'mobile' project (375px viewport via Pixel 5 device)
test.describe("Mobile responsive", () => {
  // The expo route is here because its exhibitor rows put a booth code, a name
  // and an outbound button on one line at 375px -- the densest row on the site,
  // and the most likely place for a width regression to land.
  const pages = ["/", "/brands", "/submit", CREATIVE_EXPO_URL];

  for (const url of pages) {
    test(`${url} has no horizontal overflow at 375px`, async ({ page }) => {
      const response = await page.goto(url);
      test.skip(
        response?.status() === 503 ||
          (url === CREATIVE_EXPO_URL && response?.status() === 404),
        "This public route is unavailable in the current environment.",
      );
      await page.waitForLoadState("domcontentloaded");
      await expect(page.getByRole("banner")).toBeVisible();
      const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
      const viewportWidth = page.viewportSize()?.width ?? 375;
      expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 5); // 5px tolerance
    });
  }

  test("brands directory renders a usable result or empty state on mobile", async ({
    page,
  }) => {
    await page.goto("/brands");
    const firstCard = page
      .locator('main [role="list"] [role="listitem"] article')
      .first();
    const emptyState = page.locator("[data-empty]").first();
    await expect(firstCard.or(emptyState)).toBeVisible({
      timeout: BUDGET.INTERACTIVE,
    });
  });

  test("the homepage banner exposes a navigation landmark at 375px", async ({
    page,
  }) => {
    await page.goto("/");
    // LANDMARK, not a button label. The previous form of this test looked for a
    // button named "Open menu", which never matched: the suite runs at the
    // default locale, where that name is 開啟選單. It passed only because it
    // fell through to NavCategoryTabs' <nav> — and that row is suppressed on
    // `/` now, so the fallback carried the whole assertion and then went away.
    // A role query is also the contract that actually matters: the banner must
    // offer a navigation landmark on a phone, in either locale.
    const bannerNav = page.getByRole("banner").getByRole("navigation");
    await expect(bannerNav.first()).toBeVisible({ timeout: BUDGET.RENDERED });
    // It contains the menu control, which is the only way into the header's
    // links at this width.
    await expect(
      bannerNav.first().getByRole("button").first(),
    ).toBeVisible();
  });

  test("sign-in page has no horizontal overflow at 375px", async ({ page }) => {
    // Tests auth page mobile layout — /admin redirects here for unauthenticated users.
    // The auth layout has no <header>; use <main> or the form heading as a load signal.
    await page.goto("/auth/sign-in");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByRole("heading").first()).toBeVisible({
      timeout: BUDGET.RENDERED,
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
    const response = await page.goto(CREATIVE_EXPO_URL);
    test.skip(
      response?.status() === 503 || response?.status() === 404,
      "Creative Expo is unavailable in the current environment.",
    );

    const explorer = page.getByRole("region", { name: "全部參展單位" });
    const resolvedSubject = await resolveLinkedExhibitor(explorer, "zh-TW");
    test.skip(
      resolvedSubject === null,
      "Creative Expo currently has no linked exhibitors",
    );
    const subject = resolvedSubject!;
    const zoneCode = subject.booth.split("-").at(0);
    expect(
      zoneCode,
      `Exhibitor booth has no zone: "${subject.booth}"`,
    ).toBeTruthy();

    // The zone code leads the accessible name — it is what ties the chip to
    // booth numbers on the floor plan and in every row. The selected zone and
    // brand both come from the current roster rather than a pinned exhibitor.
    const zoneChip = explorer.getByRole("button", {
      name: new RegExp(`^${zoneCode!} .+ \\d+$`),
    });
    await zoneChip.click();
    await expect(zoneChip).toHaveAttribute("aria-pressed", "true");
    await expect(page).toHaveURL(new RegExp(`\\?zone=${zoneCode!}$`));

    const search = explorer.getByRole("searchbox", {
      name: "搜尋參展單位名稱、羅馬拼音或攤位編號",
    });
    await search.fill(subject.booth);
    await expect(subject.link).toBeVisible();
    await expect(explorer.getByRole("status")).toContainText(
      /共 \d+ 個參展單位/,
    );

    await subject.link.click();
    await expect(page).toHaveURL(new RegExp(`${subject.href}$`));
    await page.goBack();
    // Only `zone` and `page` are mirrored into the URL, so the chip comes back
    // and the typed query does not -- the search text is deliberately never put
    // in a shareable link.
    await expect(page).toHaveURL(
      new RegExp(`${CREATIVE_EXPO_URL}\\?zone=${zoneCode!}$`),
    );
    await expect(zoneChip).toHaveAttribute("aria-pressed", "true");
    await expect(search).toHaveValue("");
    await search.fill(subject.booth);
    await expect(subject.link).toBeVisible();
  });
});
