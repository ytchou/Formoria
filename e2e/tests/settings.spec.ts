import { test, expect } from "../fixtures/auth";

import { BUDGET } from "../budgets";
import { getServiceClient } from "../helpers/seed";
/**
 * User Settings
 *
 * Journey: Authenticated user navigates to /settings and sees the settings
 * form populated with their account data and all preference controls.
 *
 * Actor: userPage (authenticated)
 * Seed: none
 */
test.describe("Settings page", () => {
  test("users can identify their account fields within the main landmark", async ({
    userPage,
  }) => {
    test.setTimeout(BUDGET.TEST.JOURNEY);
    const resp = await userPage.goto("/settings");
    if (resp?.status() === 503) {
      test.skip(true, "PREVIEW_MODE active — skipping");
      return;
    }

    // Page heading (zh-TW: "帳號設定")
    await expect(
      userPage.getByRole("main").getByRole("heading", { name: "帳號設定" }),
    ).toBeVisible({ timeout: BUDGET.GATED_UI });

    const emailInput = userPage.getByRole("textbox", {
      name: "電子郵件",
      exact: true,
    });
    await expect(emailInput).toBeVisible({ timeout: BUDGET.RENDERED });
    await expect(emailInput).toHaveValue(process.env.E2E_USER_EMAIL ?? "", {
      timeout: BUDGET.RENDERED,
    });

    // Display name field
    await expect(userPage.locator("#displayName")).toBeVisible({
      timeout: BUDGET.RENDERED,
    });

    // Locale preference select (options: zh-TW, en)
    const localeSelect = userPage.locator("#localePreference");
    await expect(localeSelect).toBeVisible({ timeout: BUDGET.RENDERED });

    // The newsletter is the only marketing category, plus the opt-out-of-all button
    await expect(userPage.locator("#newsletterMarketing")).toBeVisible({
      timeout: BUDGET.RENDERED,
    });
    // The owner-lifecycle opt-in is parked (DEV-1570) — re-adding it must fail here.
    await expect(userPage.locator("#lifecycleMarketing")).toHaveCount(0, {
      timeout: BUDGET.RENDERED,
    });
    await expect(
      userPage.getByRole("button", { name: "取消訂閱電子報" }),
    ).toBeVisible({ timeout: BUDGET.RENDERED });
  });

  test("a signed-in subscriber can update newsletter language without reconfirming", async ({
    isolatedUserPage,
    isolatedUser,
  }) => {
    const supabase = getServiceClient();
    const created = await supabase
      .from("newsletter_subscribers")
      .insert({
        email: isolatedUser.email,
        interests: ["brand-stories"],
        locale: "zh-TW",
        confirmed_at: new Date().toISOString(),
        consent_source: "homepage_newsletter",
        consent_version: "2026-07-16",
        consent_recorded_at: new Date().toISOString(),
      })
      .select("confirmed_at")
      .single();

    try {
      expect(created.error).toBeNull();
      await isolatedUserPage.goto("/settings");
      await isolatedUserPage.locator("#displayName").fill("陳若晴");
      await isolatedUserPage.locator("#localePreference").selectOption("en");
      await isolatedUserPage.locator("#newsletterMarketing").check();
      await isolatedUserPage
        .getByRole("button", { name: "儲存設定", exact: true })
        .click();
      await expect(isolatedUserPage).toHaveURL(/\/en\/settings\?saved=true$/, {
        timeout: BUDGET.NAVIGATION,
      });
      const persisted = await supabase
        .from("newsletter_subscribers")
        .select("locale, interests, confirmed_at, consent_source")
        .eq("email", isolatedUser.email)
        .single();
      expect(persisted.error).toBeNull();
      expect(persisted.data).toEqual({
        locale: "en",
        interests: ["brand-stories"],
        confirmed_at: created.data?.confirmed_at,
        consent_source: "settings",
      });
    } finally {
      const cleanup = await supabase
        .from("newsletter_subscribers")
        .delete()
        .eq("email", isolatedUser.email);
      expect(cleanup.error).toBeNull();
    }
  });
});
