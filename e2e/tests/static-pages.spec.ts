import { test, expect } from "../fixtures/auth";
import { ownerFeaturesDisabled } from "../helpers/owner-features";

import { BUDGET } from "../budgets";

/**
 * Static & Compliance Pages
 *
 * Journeys:
 *  - /about renders with heading
 *  - both About locales contain the mission, trust labels, and outbound vision
 *  - /vision redirects to the merged vision section on /about
 *  - /mission remains absent
 *  - /privacy renders with heading
 *  - /terms renders with heading
 *  - /challenge renders the localized verification heading with Turnstile container
 *  - /submit landing renders heading and links to the recommendation and owner flows
 *
 * Actor: anonPage (unauthenticated)
 * Seed: none — every page here is static
 */
test.describe("Static & compliance pages", () => {
  test("both About locales state the mission, trust labels, and outbound vision", async ({
    anonPage,
  }) => {
    const locales = [
      {
        path: "/about",
        heading: "搬新家、佈置店面、在市集停下來的那一刻",
        mission:
          "喜歡的東西，不該只是偶然遇見。Formoria 把相遇之後的路接起來：從一件喜歡的東西，走到它的品牌、它的故事，和買得到它的地方。",
        trustLabels: ["收錄品牌", "Formoria 選物", "品牌提供", "贊助內容"],
        boundary:
          "品牌或零售通路負責價格、規格選項、庫存、結帳、出貨與售後服務。",
        vision:
          "打造一個台灣品牌線上選物空間，讓人可以慢慢逛、找到新的偏好，認識產品背後的品牌，再前往品牌官方或實體通路。",
      },
      {
        path: "/en/about",
        heading: "Moving into a new home, setting up a shop, stopping at a market stall",
        mission:
          "Something you love shouldn't stay a chance encounter. Formoria reconnects the path after that moment: from one thing you love, to its brand, its story, and the place you can buy it.",
        trustLabels: [
          "收錄品牌 (Listed brand)",
          "Formoria 選物 (Formoria Selection)",
          "品牌提供 (Brand-provided)",
          "贊助內容 (Sponsored content)",
        ],
        boundary:
          "Brands or retailers remain responsible for price, variants, inventory, checkout, fulfilment, and after-sales service.",
        vision:
          "Build an online select space for Taiwanese brands where people can browse at their own pace, discover new preferences, get to know the brands behind the products, then continue to the brands' own online stores and stockists.",
      },
    ] as const;

    for (const locale of locales) {
      const resp = await anonPage.goto(locale.path, {
        timeout: BUDGET.GATED_UI,
      });
      if (resp?.status() === 503) {
        test.skip(true, "PREVIEW_MODE active");
        return;
      }
      await expect(
        anonPage.getByRole("heading", { level: 1, name: locale.heading }),
      ).toBeVisible({ timeout: BUDGET.SERVER_RENDER });
      await expect(
        anonPage.getByText(locale.mission, { exact: true }),
      ).toBeVisible();
      for (const trustLabel of locale.trustLabels) {
        await expect(
          anonPage.getByRole("heading", { name: trustLabel, exact: true }),
        ).toBeVisible();
      }
      await expect(
        anonPage.getByText(locale.boundary, { exact: true }).first(),
      ).toBeVisible();
      await expect(
        anonPage.getByRole("heading", { name: locale.vision }),
      ).toBeVisible();
    }
  });

  test("vision page redirects to the merged section on about", async ({
    anonPage,
  }) => {
    const resp = await anonPage.goto("/vision", { timeout: BUDGET.NAVIGATION });
    if (resp?.status() === 503) {
      test.skip(true, "PREVIEW_MODE active");
      return;
    }
    await expect(anonPage).toHaveURL(/\/about#vision$/);
    await expect(
      anonPage.getByRole("heading", {
        name: "打造一個台灣品牌線上選物空間，讓人可以慢慢逛、找到新的偏好，認識產品背後的品牌，再前往品牌官方或實體通路。",
      }),
    ).toBeVisible({ timeout: BUDGET.SERVER_RENDER });
  });

  test("mission routes remain absent", async ({ request }) => {
    expect((await request.get("/mission")).status()).toBe(404);
    expect((await request.get("/en/mission")).status()).toBe(404);
  });

  test("privacy page renders", async ({ anonPage }) => {
    const resp = await anonPage.goto("/privacy", { timeout: BUDGET.GATED_UI });
    if (resp?.status() === 503) {
      test.skip(true, "PREVIEW_MODE active");
      return;
    }
    await expect(
      anonPage.getByRole("heading", { name: "隱私權政策" }),
    ).toBeVisible({ timeout: BUDGET.SERVER_RENDER });
  });

  test("terms page renders", async ({ anonPage }) => {
    const resp = await anonPage.goto("/terms", { timeout: BUDGET.GATED_UI });
    if (resp?.status() === 503) {
      test.skip(true, "PREVIEW_MODE active");
      return;
    }
    await expect(
      anonPage.getByRole("heading", { name: "服務條款" }),
    ).toBeVisible({ timeout: BUDGET.SERVER_RENDER });
  });

  test("legal page titles are single-suffixed", async ({ anonPage }) => {
    const pages = [
      ["/terms", "服務條款 | Formoria"],
      ["/privacy", "隱私權政策 | Formoria"],
      ["/en/terms", "Terms of Service | Formoria"],
      ["/en/privacy", "Privacy Policy | Formoria"],
    ] as const;

    for (const [path, title] of pages) {
      await anonPage.goto(path, { timeout: BUDGET.GATED_UI });
      await expect(anonPage).toHaveTitle(title);
    }
  });

  test("challenge page renders the localized verification heading", async ({
    anonPage,
  }) => {
    // /challenge uses the default zh-TW locale; /en/challenge is the English variant.
    const resp = await anonPage.goto("/challenge", {
      timeout: BUDGET.GATED_UI,
    });
    if (resp?.status() === 503) {
      test.skip(true, "PREVIEW_MODE active");
      return;
    }
    await expect(
      anonPage.getByRole("heading", { name: "快速驗證" }),
    ).toBeVisible({ timeout: BUDGET.SERVER_RENDER });
    // Turnstile container (div rendered by TurnstileWidget, or the "Verifying..." text)
    // The widget may redirect quickly in dev; assert the heading appeared above.
  });

  test("submit landing page renders with recommendation and owner CTAs", async ({
    anonPage,
    browser,
  }) => {
    const resp = await anonPage.goto("/submit", { timeout: BUDGET.GATED_UI });
    if (resp?.status() === 503) {
      test.skip(true, "PREVIEW_MODE active");
      return;
    }
    // Heading: "推薦台灣品牌"
    await expect(
      anonPage.getByRole("heading", { name: "推薦台灣品牌" }),
    ).toBeVisible({ timeout: BUDGET.SERVER_RENDER });
    await expect(anonPage.locator('a[href*="/submit/recommend"]')).toBeVisible({
      timeout: BUDGET.INTERACTIVE,
    });
    // The owner fork CTA is gated by `owner_features_enabled` (DEV-1261). Assert
    // both polarities here rather than skipping: the recommendation CTA above is
    // a live consumer journey in either flag state, and the owner CTA's absence
    // while off is exactly what this PR ships.
    const ownerCta = anonPage.locator(
      'a[href*="/auth/sign-in?next=%2Fsubmit%2Fowner"]',
    );
    if (await ownerFeaturesDisabled(browser)) {
      await expect(ownerCta).toHaveCount(0);
    } else {
      await expect(ownerCta).toBeVisible({ timeout: BUDGET.INTERACTIVE });
    }
  });
});
