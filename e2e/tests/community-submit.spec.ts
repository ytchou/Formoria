import { test, expect } from "../fixtures/auth";
import { createClient } from "@supabase/supabase-js";
import { gotoSubmitOwner, gotoSubmitRecommend } from "../utils/submit-form";
import { OWNER_FEATURES_OFF_REASON } from "../helpers/owner-features";

import { BUDGET } from "../budgets";
test.describe("Community submit flow", () => {
  test.afterAll(async () => {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    const { error } = await supabase
      .from("brand_submissions")
      .delete()
      .like("brand_name", "[E2E-COMMUNITY]%");
    if (error) throw new Error(`[e2e-cleanup] community submission cleanup failed: ${error.message}`);
  });

  test("@smoke recommendation flow is available without owner-only controls", async ({
    userPage,
  }) => {
    test.setTimeout(BUDGET.TEST.JOURNEY);
    await gotoSubmitRecommend(userPage);
    await expect(userPage.locator("#submit-guest-email")).toBeVisible({
      timeout: BUDGET.RENDERED,
    });
    // The owner/recommendation split, asserted against a control the owner
    // form really renders: #submit-romanized-name exists only in
    // SubmitQuickForm. (#submit-instagram, the previous subject, exists in no
    // form at all, so its absence was guaranteed.)
    await expect(userPage.locator("#submit-romanized-name")).toHaveCount(0);
  });

  test("source attribution select is visible on the recommendation form", async ({
    userPage,
  }) => {
    test.setTimeout(BUDGET.TEST.JOURNEY);
    await gotoSubmitRecommend(userPage);
    await expect(userPage.locator("#submit-source")).toBeVisible({
      timeout: BUDGET.RENDERED,
    });
  });

  test("recommendation required fields are visible immediately", async ({
    userPage,
  }) => {
    test.setTimeout(BUDGET.TEST.JOURNEY);
    await gotoSubmitRecommend(userPage);
    await expect(userPage.locator("#submit-website")).toBeVisible({
      timeout: BUDGET.RENDERED,
    });
    await expect(userPage.locator("#submit-name")).toBeVisible({
      timeout: BUDGET.RENDERED,
    });
    await expect(userPage.locator("#submit-pdpa")).toBeVisible({
      timeout: BUDGET.INTERACTIVE,
    });
  });

  test("@smoke owner quick form shows its core fields when owner features are enabled", async ({
    userPage,
  }) => {
    test.setTimeout(BUDGET.TEST.JOURNEY);
    const probe = await userPage.goto("/submit/owner/quick");
    if (probe?.status() === 404) {
      test.skip(true, OWNER_FEATURES_OFF_REASON);
      return;
    }

    await gotoSubmitOwner(userPage);
    await expect(userPage.locator("#submit-name")).toBeVisible({
      timeout: BUDGET.RENDERED,
    });
    await expect(userPage.locator("#submit-website")).toBeVisible();
    await expect(userPage.locator("#submit-description")).toBeVisible();
  });

  // There is no submissions list page and no owner surface to fall back to, so
  // the route hands a signed-in user the home page rather than a dead end.
  // zh-TW is the default locale and its prefix is stripped, so the zh-TW home
  // page is `/` and the English one is `/en`.
  const isHomePath = (pathname: string) => /^\/(?:en)?\/?$/.test(pathname);

  // A plain `for` around `test()` at collection time, not a loop INSIDE one
  // test: both locales report independently, so an `/en` regression cannot be
  // masked by a zh-TW failure landing first (commit 4a4fc7a8).
  for (const path of ["/my-submissions", "/en/my-submissions"]) {
    test(`@smoke ${path} redirects authenticated users to the home page`, async ({
      userPage,
    }) => {
      test.setTimeout(BUDGET.TEST.JOURNEY);
      const res = await userPage.goto(path);
      expect(res?.status()).toBeLessThan(400);
      await userPage.waitForURL((url) => isHomePath(url.pathname), {
        timeout: BUDGET.SERVER_RENDER,
      });
      expect(isHomePath(new URL(userPage.url()).pathname)).toBe(true);
      await expect(userPage.locator("main, section").first()).toBeVisible({
        timeout: BUDGET.INTERACTIVE,
      });
    });
  }
});
