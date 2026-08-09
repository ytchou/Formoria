import { test, expect } from "../fixtures/auth";
import { seedBrand } from "../helpers/seed";
import {
  ownerFeaturesDisabled,
  OWNER_FEATURES_ON_REASON,
} from "../helpers/owner-features";
import { waitForViewerReady } from "../helpers/viewer-ready";

import { BUDGET } from "../budgets";
/**
 * Owner features gated off (DEV-1261).
 *
 * Journey: at launch `app_settings.owner_features_enabled` is false, so a
 * signed-in visitor is offered the consumer directory and nothing else — no
 * claim CTA on a brand page, no owner dashboard, no owner submit fork, and no
 * account-menu entry pointing at a route they cannot reach. Signing in drops
 * them on the home page rather than a dashboard that would 404.
 *
 * Actor: userPage (signed-in, non-admin — the admin exemption in
 *        dashboard/layout.tsx does not apply) and anonPage for the sign-in leg.
 * Seed: one throwaway `[E2E-TEST]` brand, removed in afterAll.
 *
 * No flag mutation happens here: `false` is the deployed default, and the suite
 * is not allowed to write app_settings. If someone turns the flag ON, every
 * expectation below is wrong by design, so the suite skips itself instead of
 * failing — the owner-flow specs take over at that point.
 */
test.beforeAll(async ({ browser }) => {
  if (!(await ownerFeaturesDisabled(browser))) {
    test.skip(true, OWNER_FEATURES_ON_REASON);
  }
});

test.describe("Owner features gated off", () => {
  let brandSlug: string;
  let brandName: string;
  let cleanup: (() => Promise<void>) | undefined;

  test.beforeAll(async ({}, workerInfo) => {
    const seeded = await seedBrand({
      name: "flag-off",
      workerIndex: workerInfo.workerIndex,
    });
    brandSlug = seeded.slug;
    brandName = seeded.brand.name;
    cleanup = seeded.cleanup;
  });

  test.afterAll(async () => {
    await cleanup?.();
  });

  test("a signed-in visitor is offered no claim CTA on a brand page", async ({
    userPage,
  }) => {
    test.setTimeout(BUDGET.TEST.MUTATION);
    const resp = await userPage.goto(`/brands/${brandSlug}`);
    if (resp?.status() === 503) {
      test.skip(
        true,
        "PREVIEW_MODE blocks the authenticated user fixture in this env.",
      );
      return;
    }

    // Anchor on the brand itself first: without this, an absence assertion would
    // also pass on a 404 page or the bot-challenge interstitial.
    await expect(
      userPage.getByRole("heading", { level: 1, name: brandName }),
    ).toBeVisible({
      timeout: BUDGET.NAVIGATION,
    });

    // The claim CTA is client-gated on ViewerContext.ownerFeaturesEnabled, so it
    // is absent before hydration too — the absence below only means anything
    // once the viewer has resolved. This used to wait on the account trigger
    // replacing its placeholder as a proxy for that; the readiness signal is the
    // thing itself, so the assertion no longer depends on an unrelated control's
    // render order (DEV-1414).
    await waitForViewerReady(userPage);

    await expect(
      userPage.getByRole("button", { name: "認領這個品牌" }),
    ).toHaveCount(0);
  });

  test("the owner dashboard and owner submit fork are unreachable for a signed-in non-admin", async ({
    userPage,
  }) => {
    test.setTimeout(BUDGET.TEST.MUTATION);
    // Signed in, so the (protected) layout's auth check passes and the flag gate
    // below it answers notFound() — a 404, not the signed-out sign-in redirect.
    const dashboard = await userPage.goto("/dashboard");
    if (dashboard?.status() === 503) {
      test.skip(
        true,
        "PREVIEW_MODE blocks the authenticated user fixture in this env.",
      );
      return;
    }
    expect(dashboard?.status()).toBe(404);
    expect(new URL(userPage.url()).pathname).not.toContain("/auth/sign-in");

    // zh-TW is the default locale and its prefix is stripped, so the unprefixed
    // path is the zh-TW surface and /en/... is the English one.
    for (const ownerPath of [
      "/submit/owner",
      "/submit/owner/details",
      "/en/submit/owner",
    ]) {
      const response = await userPage.goto(ownerPath);
      expect(response?.status(), `${ownerPath} must not be reachable`).toBe(
        404,
      );
    }
  });

  test("signing in lands on the home page, not the dashboard", async ({
    anonPage,
  }) => {
    test.setTimeout(BUDGET.TEST.ADMIN);
    const email = process.env.E2E_USER_EMAIL;
    const password = process.env.E2E_USER_PASSWORD;
    test.skip(
      !email || !password,
      "E2E_USER_EMAIL and E2E_USER_PASSWORD are required to exercise the sign-in landing.",
    );

    await anonPage.goto("/auth/sign-in");
    await expect(
      anonPage.getByRole("heading", { name: "登入 Formoria", exact: true }),
    ).toBeVisible({ timeout: BUDGET.NAVIGATION });

    await anonPage.getByLabel("電子郵件", { exact: true }).fill(email!);
    await anonPage.getByLabel("密碼", { exact: true }).fill(password!);

    await Promise.all([
      anonPage.waitForURL((url) => !url.pathname.includes("/auth/sign-in")),
      anonPage.getByRole("button", { name: "登入", exact: true }).click(),
    ]);

    const landing = new URL(anonPage.url()).pathname;
    expect(landing).not.toContain("/dashboard");
    expect(landing).toMatch(/^\/(?:en)?$/);
  });

  test("nav offers the recommendation CTA and the account menu has no my-submissions entry", async ({
    userPage,
  }) => {
    test.setTimeout(BUDGET.TEST.MUTATION);
    const resp = await userPage.goto("/");
    if (resp?.status() === 503) {
      test.skip(
        true,
        "PREVIEW_MODE blocks the authenticated user fixture in this env.",
      );
      return;
    }

    // Account trigger visible ⇒ useUser() resolved ⇒ the nav below reflects the
    // real viewer rather than its pre-hydration guess.
    const accountTrigger = userPage.getByRole("button", {
      name: /account|帳號/i,
    });
    await expect(accountTrigger).toBeVisible({ timeout: BUDGET.GATED_UI });

    const header = userPage.locator("header").first();
    const submitCta = header.getByRole("link", { name: "推薦品牌" }).first();
    await expect(submitCta).toBeVisible({ timeout: BUDGET.SERVER_RENDER });
    await expect(submitCta).toHaveAttribute("href", /^(?:\/en)?\/submit$/);
    // The "我的品牌" dashboard link is the branch the flag turns off.
    await expect(header.getByRole("link", { name: "我的品牌" })).toHaveCount(0);

    await accountTrigger.click();
    const accountMenu = userPage.locator('[data-slot="dropdown-menu-content"]');
    await expect(accountMenu).toBeVisible({ timeout: BUDGET.SERVER_RENDER });
    // Sanity: the menu really did open with its always-on entries.
    await expect(
      accountMenu.getByRole("menuitem", { name: "帳號設定" }),
    ).toBeVisible({
      timeout: BUDGET.INTERACTIVE,
    });
    await expect(
      accountMenu.getByRole("menuitem", { name: "我的推薦" }),
    ).toHaveCount(0);
    await expect(accountMenu.locator('a[href*="my-submissions"]')).toHaveCount(
      0,
    );
  });
});
