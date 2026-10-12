import { test, expect } from "../fixtures/auth";
import { load } from "cheerio";
import assert from "node:assert/strict";

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
      heading: "Sign in",
      submittedLocale: "en",
    });
  });

  test("sign-in HTML honors the locale cookie", async ({
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

test.describe("Auth — sign-in context", () => {
  test("names the page that sent the visitor to sign in", async ({
    anonPage,
  }) => {
    await anonPage.goto("/auth/sign-in?next=%2Ffavorites");

    await expect(
      anonPage.getByRole("heading", { name: "登入 Formoria", exact: true }),
    ).toBeVisible({ timeout: BUDGET.NAVIGATION });
    await expect(
      anonPage.getByText("登入後即可查看你的收藏", { exact: true }),
    ).toBeVisible();
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

    assert(email && password, "E2E_USER_EMAIL and E2E_USER_PASSWORD must be set");

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
    // Sign-in honours `?next=` and otherwise lands home; this spec only asserts
    // that the user left the sign-in page authenticated.
    // The account menu button in the main nav is always visible when authenticated.
    await expect(
      anonPage.getByRole("button", { name: /account|帳號/i }),
    ).toBeVisible({
      timeout: BUDGET.INTERACTIVE,
    });
  });
});

test.describe("Auth — repeated failure recovery", () => {
  for (const { locale, prefix } of [
    { locale: "zh-TW", prefix: "" },
    { locale: "en", prefix: "/en" },
  ]) {
    test(`each invalid sign-in attempt returns focus to the error (${locale})`, async ({
      anonPage,
    }) => {
      test.setTimeout(BUDGET.TEST.ADMIN);
      const email = process.env.E2E_USER_EMAIL;
      assert(email, "E2E_USER_EMAIL must be set");
      await anonPage.goto(`${prefix}/auth/sign-in`);
      await expect(anonPage.locator("html")).toHaveAttribute(
        "data-viewer-state",
        "ready",
        { timeout: BUDGET.NAVIGATION },
      );
      const form = anonPage.locator('form:has(input[name="email"])');
      const alert = anonPage.getByRole("main").getByRole("alert");
      for (let attempt = 0; attempt < 2; attempt++) {
        await form.locator('input[name="email"]').fill(email);
        await form
          .locator('input[name="password"]')
          .fill("codex-deliberately-invalid-password-20261011");
        const responsePromise = anonPage.waitForResponse(
          (response) =>
            response.request().method() === "POST" &&
            Boolean(response.request().headers()["next-action"]),
        );
        await form.locator('button[type="submit"]').click();
        const response = await responsePromise;
        expect(response.status()).toBe(200);
        await expect(form.locator('button[type="submit"]')).toBeEnabled();
        await expect(alert).toHaveText(
          locale === "zh-TW"
            ? "電子郵件或密碼不正確，請再檢查一次。"
            : "Your email or password is incorrect. Check them and try again.",
        );
        await expect(alert).toBeFocused();
        await expect(form.locator('input[name="email"]')).toHaveValue(email);
      }
    });
  }
});
