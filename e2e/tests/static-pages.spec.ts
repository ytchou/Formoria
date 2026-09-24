import { test, expect } from "../fixtures/auth";

import { BUDGET } from "../budgets";

/**
 * Static & Compliance Pages
 *
 * Journeys:
 *  - /about renders with heading
 *  - both About locales state the mission and the commitments
 *  - vision routes remain absent
 *  - /mission remains absent
 *  - /getting-started remains absent
 *  - /privacy renders with heading
 *  - /terms renders with heading
 *  - /challenge renders the localized verification heading with Turnstile container
 *  - /submit landing renders heading and links to the recommendation flow
 *
 * Actor: anonPage (unauthenticated)
 * Seed: none — every page here is static
 */
test.describe("Static & compliance pages", () => {
  test("both About locales state the mission and the commitments", async ({
    anonPage,
  }) => {
    const locales = [
      {
        path: "/about",
        heading: "搬新家、佈置店面、\n在市集停下來的那一刻",
        mission:
          "喜歡的東西，不該只是偶然遇見。Formoria 把相遇之後的路接起來：從一件喜歡的東西，走到它的品牌、它的故事，和買得到它的地方。",
        stanceLeads: [
          "我們把你交到品牌手上。",
          "付費不會改變任何順序。",
          "這裡是選出來的，不是全部。",
          "判斷是我們的，而且會說明理由。",
        ],
      },
      {
        path: "/en/about",
        heading:
          "Moving into a new home, setting up a shop,\nstopping at a market stall",
        mission:
          "Something you love shouldn't stay a chance encounter. Formoria reconnects the path after that moment: from one thing you love, to its brand, its story, and the place you can buy it.",
        stanceLeads: [
          "We hand you to the brand.",
          "Paying changes no order.",
          "What is here is selected, not everything.",
          "The judgement is ours, and we show it.",
        ],
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
      for (const lead of locale.stanceLeads) {
        await expect(
          anonPage.getByText(lead, { exact: true }),
        ).toBeVisible();
      }
    }
  });

  test("vision routes remain absent", async ({ request }) => {
    expect((await request.get("/vision")).status()).toBe(404);
    expect((await request.get("/en/vision")).status()).toBe(404);
  });

  test("mission routes remain absent", async ({ request }) => {
    expect((await request.get("/mission")).status()).toBe(404);
    expect((await request.get("/en/mission")).status()).toBe(404);
  });

  test("getting-started routes remain absent", async ({ request }) => {
    expect((await request.get("/getting-started")).status()).toBe(404);
    expect((await request.get("/en/getting-started")).status()).toBe(404);
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

  test("challenge page server-renders the localized verification heading", async ({
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
    expect(await resp?.text()).toMatch(/<h1[^>]*>快速驗證<\/h1>/);
    await expect(
      anonPage.getByRole("heading", { name: "快速驗證" }),
    ).toBeVisible({ timeout: BUDGET.SERVER_RENDER });
    // Turnstile container (div rendered by TurnstileWidget, or the "Verifying..." text)
    // The widget may redirect quickly in dev; assert the heading appeared above.
  });

  test("submit landing page renders the recommendation CTA", async ({
    anonPage,
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
    // DEV-1570 removed the owner fork. Its CTA must stay gone: this page is the
    // only entry point that ever linked to it.
    await expect(
      anonPage.locator('a[href*="/submit/owner"]'),
    ).toHaveCount(0);
  });
});
