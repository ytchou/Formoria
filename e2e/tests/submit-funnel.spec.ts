import { test, expect } from "../fixtures/auth";
import type { Locator, Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { BUDGET } from "../budgets";
import { OWNER_FEATURES_OFF_REASON } from "../helpers/owner-features";

/**
 * Turnstile is normally solved by the addInitScript mock. When that has not
 * fired, post the synthetic Cloudflare success message as a last resort.
 *
 * Lives outside the test body on purpose: branching on page state inside a test
 * means some assertions never run on some paths, so the caller asserts the
 * outcome unconditionally instead and this helper only nudges.
 */
async function ensureTurnstileSolved(page: Page, submitBtn: Locator) {
  if (await submitBtn.isEnabled()) return;

  // Harmless when the mock is merely slow: the suite runs against dummy
  // Turnstile keys, so any token validates. The caller does the waiting.
  await page.evaluate(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({
          event: "turnstile-callback",
          token: "e2e-fallback-token",
        }),
        origin: "https://challenges.cloudflare.com",
      }),
    );
  });
}

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * Submit Funnel End-to-End
 *
 * Journey: Guest user navigates to /submit/recommend, fills all required
 * fields, waits for Turnstile to auto-complete in dev mode, submits the form,
 * and lands on the /submit/confirmation page.
 *
 * Actor: anonPage (guest)
 * Seed: none — creates a brand_submissions row on submit
 * Cleanup: afterAll deletes brand_submissions rows matching [E2E-TEST] Submit Funnel%
 *
 * Turnstile: In dev/test mode, window.turnstile is overridden via addInitScript
 * to immediately fire onSuccess before React mounts, so the submit button is
 * enabled as soon as all other fields are valid.
 */
test.describe("Submit funnel", () => {
  test.describe.configure({ mode: "serial" });

  test.afterAll(async () => {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    await supabase
      .from("brand_submissions")
      .delete()
      .like("brand_name", "[E2E-TEST] Submit Funnel%");
  });

  test("submits brand and reaches confirmation page", async ({
    anonPage,
  }, workerInfo) => {
    test.setTimeout(BUDGET.TEST.JOURNEY);
    const ts = Date.now();
    const wi = workerInfo.workerIndex;
    const brandName = `[E2E-TEST] Submit Funnel ${ts}-${wi}`;
    const websiteUrl = `https://e2e-submit-${ts}-${wi}.example.com`;

    // Override window.turnstile BEFORE navigating so the widget immediately
    // calls onSuccess with a fake token.  addInitScript persists for all
    // subsequent navigations on this page instance.
    await anonPage.addInitScript(() => {
      Object.defineProperty(window, "turnstile", {
        configurable: true,
        get() {
          return {
            render(_el: HTMLElement, opts: { callback: (t: string) => void }) {
              setTimeout(() => opts.callback("e2e-bypass-token"), 50);
              return "fake-widget-id";
            },
            remove() {},
          };
        },
      });
    });

    // Navigate with PREVIEW_MODE guard
    const resp = await anonPage.goto("/submit/recommend");
    if (resp?.status() === 503) {
      test.skip(true, "PREVIEW_MODE active — skipping");
      return;
    }

    // Auth-redirect resilience: middleware can transiently send to /auth/sign-in
    if (anonPage.url().includes("/auth/sign-in")) {
      await anonPage.goto("/submit/recommend");
    }

    // Wait for the flat-form heading (confirms hydration)
    await expect(
      anonPage.getByRole("heading", { name: "推薦品牌", exact: true }),
    ).toBeVisible({ timeout: 30_000 });

    // Fill required fields
    await anonPage.locator("#submit-website").fill(websiteUrl);
    await anonPage.locator("#submit-name").fill(brandName);

    // Source attribution is required when isOwner is unchecked (default)
    await anonPage.locator("#submit-source").selectOption("found_online");

    // PDPA consent
    await anonPage.locator("#submit-pdpa").check();

    const submitBtn = anonPage.getByRole("button", { name: "送出推薦" });
    await ensureTurnstileSolved(anonPage, submitBtn);
    // The single assertion that decides whether the widget was solved. It used
    // to sit inside the fallback's catch block, and the fallback ended in a
    // fixed 500ms sleep that passed whether or not the token was ever accepted —
    // so a dropped message surfaced 20 lines later as a confirmation-URL
    // timeout, looking like a slow submit (DEV-1414).
    await expect(submitBtn).toBeEnabled({ timeout: BUDGET.INTERACTIVE });

    await submitBtn.click();

    // Must land on the confirmation page
    await anonPage.waitForURL(/\/submit\/confirmation/, { timeout: 30_000 });

    // Confirmation heading
    await expect(
      anonPage.getByRole("heading", { name: "我們已收到你的品牌推薦" }),
    ).toBeVisible({ timeout: 15_000 });

    // Both CTAs: return home and submit another
    await expect(anonPage.locator('a[href="/"]').first()).toBeVisible();
    await expect(anonPage.locator('a[href="/submit"]').first()).toBeVisible();

    // Verify brand_submissions row was created in DB
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    let savedSubmission: {
      intent: string;
      source_attribution: string | null;
      submitter_email: string | null;
    } | null = null;
    await expect
      .poll(
        async () => {
          const { data, error } = await supabase
            .from("brand_submissions")
            .select("id, intent, source_attribution, submitter_email")
            .eq("brand_name", brandName)
            .maybeSingle();
          if (error && error.code !== "PGRST116") throw error;
          savedSubmission = data;
          return Boolean(data);
        },
        { timeout: 30_000, intervals: [500, 1_000, 2_000, 5_000] },
      )
      .toBe(true);

    expect(savedSubmission).toMatchObject({
      intent: "recommend",
      source_attribution: "found_online",
    });
    expect(savedSubmission?.submitter_email).toMatch(
      /^guest\+.+@guest\.formoria\.invalid$/,
    );
  });

  test("detailed owner wizard writes only on final submit and preserves shared links", async ({
    userPage,
  }, workerInfo) => {
    test.setTimeout(BUDGET.TEST.ADMIN);
    const ts = Date.now();
    const brandName = `[E2E-TEST] Submit Funnel Detailed ${ts}-${workerInfo.workerIndex}`;
    const sourceWebsite = `https://detailed-${ts}.example.com`;
    const purchaseWebsite = `https://shop-${ts}.example.com`;

    await userPage.addInitScript(() => {
      Object.defineProperty(window, "turnstile", {
        configurable: true,
        get() {
          return {
            render(
              _el: HTMLElement,
              opts: { callback: (token: string) => void },
            ) {
              setTimeout(() => opts.callback("e2e-bypass-token"), 50);
              return "fake-widget-id";
            },
            remove() {},
          };
        },
      });
    });

    const resp = await userPage.goto("/submit/owner/details");
    if (resp?.status() === 503) {
      test.skip(true, "PREVIEW_MODE active — skipping");
      return;
    }
    // The owner fork 404s while owner features are gated off (DEV-1261). Probed
    // from the navigation that is already here rather than from app_settings.
    if (resp?.status() === 404) {
      test.skip(true, OWNER_FEATURES_OFF_REASON);
      return;
    }

    await expect(
      userPage.getByRole("heading", { name: "填寫品牌資料", exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    await userPage.locator("#name").fill(brandName);
    await userPage.locator("#romanizedName").fill("Detailed Wizard Brand");
    await expect(userPage.locator("#brand-url-preview")).toHaveValue(
      "/brands/detailed-wizard-brand",
    );
    await userPage.locator("#submission-website").fill(sourceWebsite);
    await userPage.locator("#description").fill("台灣製造的詳細提交測試品牌。");

    await userPage.getByRole("button", { name: "儲存並繼續" }).click();
    await expect(userPage.locator("#media")).toBeVisible({ timeout: 30_000 });

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    const submissionCount = async () => {
      const { count } = await supabase
        .from("brand_submissions")
        .select("id", { count: "exact", head: true })
        .eq("brand_name", brandName);
      return count ?? 0;
    };
    await expect.poll(submissionCount).toBe(0);

    const uploadResponsePromise = userPage.waitForResponse(
      (response) =>
        response.url().includes("/api/upload") &&
        response.request().method() === "POST",
      { timeout: 20_000 },
    );
    await userPage.locator("#image-upload-heroImageUrl").setInputFiles({
      name: "detailed-hero.png",
      mimeType: "image/png",
      buffer: TINY_PNG,
    });
    expect((await uploadResponsePromise).status()).toBe(200);
    await expect(
      userPage.locator("#image-upload-heroImageUrl-replace"),
    ).toBeVisible({ timeout: 10_000 });

    await userPage.getByRole("button", { name: "儲存並繼續" }).click();
    await expect(userPage.locator("#purchase")).toBeVisible({
      timeout: 30_000,
    });
    await expect(userPage.locator("#purchase fieldset")).toHaveCount(3);
    // 3 social + 4 purchase channels (PURCHASE_CHANNELS). Bump when a channel is added.
    await expect(userPage.locator("#purchase [data-platform-row]")).toHaveCount(
      7,
    );
    await userPage.locator("#socialInstagram").fill("@detailed-wizard");
    await userPage.locator("#purchaseWebsite").fill(purchaseWebsite);
    await userPage.getByLabel("標籤", { exact: true }).first().fill("媒體報導");
    await userPage
      .getByLabel("網址", { exact: true })
      .first()
      .fill(`https://press-${ts}.example.com`);
    await expect.poll(submissionCount).toBe(0);

    await userPage.locator("#submission-pdpa").check();

    const submitButton = userPage.getByRole("button", { name: "送出品牌資料" });
    await expect(submitButton).toBeEnabled({ timeout: 15_000 });
    await submitButton.click();
    await userPage.waitForURL(/\/submit\/confirmation/, { timeout: 30_000 });

    const { data, error } = await supabase
      .from("brand_submissions")
      .select("romanized_name, purchase_website, other_urls")
      .eq("brand_name", brandName)
      .single();
    expect(error).toBeNull();
    expect(data?.romanized_name).toBe("Detailed Wizard Brand");
    expect(data?.purchase_website).toBe(purchaseWebsite);
    expect(data?.other_urls).toEqual([
      { label: "媒體報導", url: `https://press-${ts}.example.com` },
    ]);
  });
});
