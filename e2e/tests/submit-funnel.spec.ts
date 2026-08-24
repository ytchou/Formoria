import { test, expect } from "../fixtures/auth";
import type { Locator, Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { BUDGET, POLL } from "../budgets";

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
    // Deployed staging answers 403 to every anonymous mutation
    // (`isAllowedStagingRequest` in src/lib/deployment-environment.ts allows only
    // GET plus the /auth/* POSTs), so this journey's write cannot complete on the
    // one environment this suite targets. Measured, not inferred: anonymous POSTs
    // to /submit/recommend and /api/newsletter/subscribe both return 403 there
    // while /auth/sign-up returns 200.
    test.skip(
      process.env.FORMORIA_DEPLOYMENT_ENV === "staging",
      "staging blocks anonymous mutations",
    );
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
              opts.callback("e2e-bypass-token");
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
    ).toBeVisible({ timeout: BUDGET.GATED_UI });

    // Fill required fields
    await anonPage.locator("#submit-website").fill(websiteUrl);
    await anonPage.locator("#submit-name").fill(brandName);

    // Source attribution is required on the recommendation form.
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
    await anonPage.waitForURL(/\/submit\/confirmation/, { timeout: BUDGET.GATED_UI });

    // Confirmation heading
    await expect(
      anonPage.getByRole("heading", { name: "我們已收到你的品牌推薦" }),
    ).toBeVisible({ timeout: BUDGET.SERVER_RENDER });

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
        POLL.NAVIGATION,
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
});
