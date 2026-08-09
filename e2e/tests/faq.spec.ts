import { BUDGET } from "../budgets";
import { test, expect } from "../fixtures/auth";
import zhTW from "../../messages/zh-TW.json";

/** Every `faq.items` entry renders as one <details>; see the count assertion below. */
const EXPECTED_FAQ_ITEMS = Object.keys(zhTW.faq.items).length;

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
    const resp = await anonPage.goto("/faq", { timeout: BUDGET.GATED_UI });
    if (resp?.status() === 503) {
      test.skip(true, "PREVIEW_MODE active — skipping");
      return;
    }

    // Both section-level h2 headings must be present
    await expect(
      anonPage.getByRole("heading", { name: "一般問題", level: 2 }),
    ).toBeVisible({
      timeout: BUDGET.SERVER_RENDER,
    });
    await expect(
      anonPage.getByRole("heading", { name: "品牌主專區", level: 2 }),
    ).toBeVisible({
      timeout: BUDGET.RENDERED,
    });

    // Derived from the message catalogue rather than hardcoded. This was a bare
    // `toHaveCount(14)` whose own comment admitted that adding a FAQ entry turns
    // the spec red — a test that has to be edited every time the content it
    // covers changes trains people to edit tests rather than read them
    // (DEV-1414).
    //
    // The coupling is deliberate: every entry under `faq.items` is expected to
    // render as a <details>, so a mismatch means either an entry the page never
    // renders or a rendered item with no copy. Both are worth failing on.
    await expect(anonPage.locator("details")).toHaveCount(EXPECTED_FAQ_ITEMS, {
      timeout: BUDGET.RENDERED,
    });
  });

  test("#for-owners anchor scrolls the section into viewport", async ({
    anonPage,
  }) => {
    const resp = await anonPage.goto("/faq#for-owners", { timeout: BUDGET.GATED_UI });
    if (resp?.status() === 503) {
      test.skip(true, "PREVIEW_MODE active — skipping");
      return;
    }

    // The <section id="for-owners"> must be within the viewport after hash navigation
    await expect(anonPage.locator("#for-owners")).toBeInViewport({
      timeout: BUDGET.INTERACTIVE,
    });
  });

  test("#claim details auto-opens via OpenTargetDetails on hash navigation", async ({
    anonPage,
  }) => {
    const resp = await anonPage.goto("/faq#claim", { timeout: BUDGET.GATED_UI });
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
    }).toPass({ timeout: BUDGET.RENDERED });
  });
});
