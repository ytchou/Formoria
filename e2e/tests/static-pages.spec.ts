import { test, expect } from "../fixtures/auth";

import { BUDGET } from "../budgets";
import zhTW from "../../messages/zh-TW.json";

/**
 * Every legal section as `[id, heading]`, read from the catalogue: a section is
 * the object carrying a `heading`. The in-page contents nav is expected to link
 * each one by its id, so a section added to the copy and not to the page fails.
 */
function legalSections(doc: Record<string, unknown>): Array<[string, string]> {
  return Object.entries(doc).flatMap(([key, value]) =>
    typeof value === "object" && value !== null && "heading" in value
      ? [[key, String(value.heading)] as [string, string]]
      : [],
  );
}
const PRIVACY_SECTIONS = legalSections(zhTW.legal.privacy);
const TERMS_SECTIONS = legalSections(zhTW.legal.terms);

/**
 * Static & Compliance Pages
 *
 * Journeys:
 *  - /about renders with heading
 *  - both About locales state the mission and the commitments, and exit
 *    product-led (hero to /discover, closing band to /style)
 *  - vision routes remain absent
 *  - /mission remains absent
 *  - /getting-started remains absent
 *  - /privacy and /terms render an h1, a 本頁內容 nav linking every section,
 *    and their contact addresses as mailto links
 *  - /contact shows its heading, the address in plain text with a copy
 *    button, and a meta description without 許願
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
        heading: /搬新家、佈置店面、\s*在市集\s*停下來的那一刻/,
        mission:
          "喜歡的東西，不該只是偶然遇見。Formoria 把相遇之後的路接起來：從一件喜歡的東西，走到它的品牌、它的故事，和買得到它的地方。",
        stanceLeads: [
          "我們把你交到品牌手上。",
          "付錢買不到位置。",
          "找不到，不代表不存在。",
          "判斷是我們的，而且會說明理由。",
        ],
        // Product-led exits: the hero and the closing band lead to products
        // and guides; the brand directory is the secondary link.
        exits: [
          { name: "逛商品", href: "/discover" },
          { name: "看看主題選物", href: "/style" },
        ],
      },
      {
        path: "/en/about",
        heading:
          /Moving into a new home, styling a shop,\s*the moment you stop at a market stall/,
        mission:
          "The things you love shouldn't just be chance encounters. Formoria reconnects the path after that moment: from one thing you love, to its brand, its story, and the place you can buy it.",
        stanceLeads: [
          "We send you on to the brand.",
          "Payment buys no placement.",
          "Not finding it here doesn't mean it doesn't exist.",
          "The judgment is ours, and we show it.",
        ],
        exits: [
          { name: "Browse products", href: "/en/discover" },
          { name: "Browse guides", href: "/en/style" },
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
      for (const exit of locale.exits) {
        await expect(
          anonPage
            .getByRole("main")
            .getByRole("link", { name: exit.name, exact: true }),
        ).toHaveAttribute("href", exit.href);
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
      anonPage.getByRole("heading", { name: "隱私權政策", level: 1 }),
    ).toBeVisible({ timeout: BUDGET.SERVER_RENDER });

    const toc = anonPage.getByRole("navigation", { name: "本頁內容" });
    await expect(toc.getByRole("link")).toHaveCount(PRIVACY_SECTIONS.length);
    for (const [id, heading] of PRIVACY_SECTIONS) {
      await expect(
        toc.getByRole("link", { name: heading, exact: true }),
      ).toHaveAttribute("href", `#${id}`);
    }

    await expect(
      anonPage.locator('a[href="mailto:privacy@formoria.com"]').first(),
    ).toBeVisible();
  });

  test("terms page renders", async ({ anonPage }) => {
    const resp = await anonPage.goto("/terms", { timeout: BUDGET.GATED_UI });
    if (resp?.status() === 503) {
      test.skip(true, "PREVIEW_MODE active");
      return;
    }
    await expect(
      anonPage.getByRole("heading", { name: "服務條款", level: 1 }),
    ).toBeVisible({ timeout: BUDGET.SERVER_RENDER });

    const toc = anonPage.getByRole("navigation", { name: "本頁內容" });
    await expect(toc.getByRole("link")).toHaveCount(TERMS_SECTIONS.length);
    for (const [id, heading] of TERMS_SECTIONS) {
      await expect(
        toc.getByRole("link", { name: heading, exact: true }),
      ).toHaveAttribute("href", `#${id}`);
    }

    await expect(
      anonPage.locator('a[href="mailto:hello@formoria.com"]').first(),
    ).toBeVisible();
  });

  // The address used to sit behind a mailto button only, which does nothing
  // for a reader with no mail client. It is now printed with a copy button.
  test("contact page shows the address and a copy button", async ({
    anonPage,
  }) => {
    await anonPage.goto("/contact", { timeout: BUDGET.GATED_UI });

    await expect(
      anonPage.getByRole("heading", {
        name: "要聯絡我們，先選對管道",
        level: 1,
      }),
    ).toBeVisible({ timeout: BUDGET.SERVER_RENDER });
    await expect(
      anonPage.getByRole("main").getByText("hello@formoria.com", { exact: true }),
    ).toBeVisible();
    await expect(
      anonPage.getByRole("button", { name: "複製信箱" }),
    ).toBeVisible();
    await expect(anonPage.locator('meta[name="description"]')).not.toHaveAttribute(
      "content",
      /許願/,
    );
  });

  test("legal page titles are single-suffixed", async ({ anonPage }) => {
    const pages = [
      ["/terms", "服務條款｜Formoria"],
      ["/privacy", "隱私權政策｜Formoria"],
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

  // DEV-1988 (SP2-05): the /submit hub held one card whose only action led to
  // the form, so it now redirects there. The hub's no-account bullets and the
  // brand-owner line moved above the form.
  test("/submit redirects to the recommend form", async ({ anonPage }) => {
    const resp = await anonPage.goto("/submit", { timeout: BUDGET.GATED_UI });
    if (resp?.status() === 503) {
      test.skip(true, "PREVIEW_MODE active");
      return;
    }
    await expect(anonPage).toHaveURL(/\/submit\/recommend$/);
    await expect(
      anonPage.getByRole("heading", { level: 1, name: "推薦品牌" }),
    ).toBeVisible({ timeout: BUDGET.SERVER_RENDER });
    await expect(anonPage.getByText("不用登入，也不用註冊帳號")).toBeVisible({
      timeout: BUDGET.INTERACTIVE,
    });
    // DEV-1570 removed the owner fork. Its CTA must stay gone.
    await expect(
      anonPage.locator('a[href*="/submit/owner"]'),
    ).toHaveCount(0);
  });
});
