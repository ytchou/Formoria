import { test, expect } from "../fixtures/auth";
import { load } from "cheerio";

import { BUDGET, POLL } from "../budgets";
function signInDocument(html: string) {
  const $ = load(html);
  const credentialForm = $("form").has('input[name="email"]');

  return {
    lang: $("html").attr("lang"),
    heading: $("h1, h2").first().text().trim(),
    submittedLocale: credentialForm.find('input[name="locale"]').attr("value"),
  };
}

test.describe("Auth — locale intent", () => {
  test("the English sign-in page submits the English locale", async ({
    request,
  }) => {
    // Auth pages live under [locale] now, so the English render has its own URL
    // rather than being negotiated onto the prefix-free one.
    const response = await request.get("/en/auth/sign-in", {
      headers: { "accept-language": "en-US,en;q=0.9" },
    });

    expect(response.status()).toBe(200);
    const document = signInDocument(await response.text());
    expect(document).toEqual({
      lang: "en",
      heading: "Sign In",
      submittedLocale: "en",
    });
  });

  test("sign-in HTML honors the locale cookie over browser inference", async ({
    request,
  }) => {
    const response = await request.get("/auth/sign-in", {
      headers: {
        "accept-language": "en-US,en;q=0.9",
        cookie: "NEXT_LOCALE=zh-TW",
      },
    });

    expect(response.status()).toBe(200);
    const document = signInDocument(await response.text());
    expect(document).toEqual({
      lang: "zh-TW",
      heading: "登入 Formoria",
      submittedLocale: "zh-TW",
    });
  });
});

test.describe("Auth — Google OAuth offline guard", () => {
  /**
   * Verifies that the Google OAuth entry point is wired correctly without
   * completing the OAuth flow. Clicking the Google button triggers a Server
   * Action that calls supabase.auth.signInWithOAuth, which returns a URL like:
   *   https://<project>.supabase.co/auth/v1/authorize?provider=google&...
   * The server then redirects the browser to that URL. We intercept the browser
   * navigation to *.supabase.co/auth/v1/authorize, abort it, and assert
   * provider=google is present in the URL — no live Google navigation occurs.
   */
  test("@smoke sign-in page renders the heading and Google entry point", async ({
    anonPage,
  }) => {
    test.setTimeout(BUDGET.TEST.ADMIN);
    let capturedAuthorizeUrl: string | null = null;

    // Intercept the browser navigation to Supabase /auth/v1/authorize and abort it
    await anonPage.route("**/auth/v1/authorize**", async (route) => {
      capturedAuthorizeUrl = route.request().url();
      await route.abort();
    });

    await anonPage.goto("/auth/sign-in");

    await expect(
      anonPage.getByRole("heading", { name: "登入 Formoria", exact: true }),
    ).toBeVisible({ timeout: BUDGET.NAVIGATION });

    // Button must be visible before any click
    const googleBtn = anonPage.getByRole("button", {
      name: "使用 Google 登入",
      exact: true,
    });
    await expect(googleBtn).toBeVisible({ timeout: BUDGET.NAVIGATION });

    // Click — the Server Action fires, and the browser is redirected to Supabase /authorize.
    // The route intercept aborts that navigation; a navigation error is expected — swallow it.
    await Promise.race([
      googleBtn.click(),
      anonPage
        .waitForURL("**/auth/v1/authorize**", { timeout: BUDGET.INTERACTIVE })
        .catch(() => {}),
    ]).catch(() => {});

    await expect.poll(() => capturedAuthorizeUrl, POLL.UI).toBeTruthy();

    // The intercepted URL must include provider=google
    expect(capturedAuthorizeUrl).not.toBeNull();
    expect(capturedAuthorizeUrl).toContain("provider=google");
  });
});

test.describe("Auth — sign-in flow", () => {
  test("signs in through the UI and leaves the sign-in page authenticated", async ({
    anonPage,
  }) => {
    // Supabase signInWithPassword and a cold-compile of the landing page can be
    // slow in dev.
    test.setTimeout(BUDGET.TEST.ADMIN);
    const email = process.env.E2E_USER_EMAIL;
    const password = process.env.E2E_USER_PASSWORD;

    if (!email || !password) {
      throw new Error("E2E_USER_EMAIL and E2E_USER_PASSWORD must be set");
    }

    await anonPage.goto("/auth/sign-in");

    await expect(
      anonPage.getByRole("heading", { name: "登入 Formoria", exact: true }),
    ).toBeVisible({
      timeout: BUDGET.NAVIGATION,
    });
    await anonPage.getByLabel("電子郵件", { exact: true }).fill(email);
    await anonPage.getByLabel("密碼", { exact: true }).fill(password);

    await Promise.all([
      // Server Action → Supabase round-trip plus a cold-compile of the landing
      // page can be slow in dev.
      anonPage.waitForURL((url) => !url.pathname.includes("/auth/sign-in")),
      anonPage.getByRole("button", { name: "登入", exact: true }).click(),
    ]);

    await expect(anonPage).not.toHaveURL(/\/auth\/sign-in(?:[/?#]|$)/);
    // Where sign-in lands depends on the owner-features flag, so this spec only
    // asserts that the user left the sign-in page authenticated. The flag-off
    // landing (`/`, not `/dashboard`) is owned by owner-features-flag-off.spec.ts.
    // The account menu button in the main nav is always visible when authenticated.
    await expect(
      anonPage.getByRole("button", { name: /account|帳號/i }),
    ).toBeVisible({
      timeout: BUDGET.INTERACTIVE,
    });
  });
});
