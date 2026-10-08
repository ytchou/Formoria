import { test, expect } from "../fixtures/auth";
import type { Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { BUDGET, POLL } from "../budgets";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

/**
 * Turnstile is normally solved by the addInitScript mock. Post the synthetic
 * Cloudflare success message as well, as a last resort for when the mock has
 * not fired.
 *
 * Unconditional on purpose: the submit button is always enabled now (DEV-1955),
 * so there is no page state to branch on, and branching inside a test means
 * some assertions never run on some paths. The caller asserts the outcome
 * instead and this helper only nudges.
 */
async function ensureTurnstileSolved(page: Page) {
  // Harmless when the mock already fired: the suite runs against dummy
  // Turnstile keys, so any token validates.
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
 * to immediately fire onSuccess as soon as the widget mounts.
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

    // Fill required fields. The website is typed without its scheme: the blur
    // handler writing `https://` back proves the form is hydrated, which the
    // always-enabled submit button no longer does.
    const websiteInput = anonPage.locator("#submit-website");
    await websiteInput.fill(websiteUrl.replace(/^https:\/\//, ""));
    await anonPage.locator("#submit-name").fill(brandName);
    await expect(websiteInput).toHaveValue(websiteUrl, {
      timeout: BUDGET.INTERACTIVE,
    });

    // Source attribution is required on the recommendation form.
    await anonPage.locator("#submit-source").selectOption("found_online");

    // PDPA consent
    await anonPage.locator("#submit-pdpa").check();

    await ensureTurnstileSolved(anonPage);

    await anonPage.getByRole("button", { name: "送出推薦" }).click();

    // The single assertion that decides whether the widget was solved: an
    // empty token is listed under the button once submit is clicked. It used
    // to sit inside the fallback's catch block, and the fallback ended in a
    // fixed 500ms sleep that passed whether or not the token was ever accepted —
    // so a dropped message surfaced 20 lines later as a confirmation-URL
    // timeout, looking like a slow submit (DEV-1414). Counted page-wide rather
    // than inside #submit-blockers so it still holds once the page navigates.
    await expect(anonPage.getByText("請完成真人驗證")).toHaveCount(0, {
      timeout: BUDGET.INTERACTIVE,
    });

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
    const supabase: AnySupabaseClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    type SavedSubmission = {
      intent: string;
      source_attribution: string | null;
      submitter_email: string | null;
    };
    // The cast stops TS narrowing the `let` to `null`: it is assigned inside
    // the poll callback, which control-flow analysis does not follow.
    let savedSubmission = null as SavedSubmission | null;
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
