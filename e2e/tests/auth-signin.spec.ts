import { test, expect } from '../fixtures/auth';

test.describe('Auth — Google OAuth offline guard', () => {
  /**
   * Verifies that the Google OAuth entry point is wired correctly without
   * completing the OAuth flow. Clicking the Google button triggers a Server
   * Action that calls supabase.auth.signInWithOAuth, which returns a URL like:
   *   https://<project>.supabase.co/auth/v1/authorize?provider=google&...
   * The server then redirects the browser to that URL. We intercept the browser
   * navigation to *.supabase.co/auth/v1/authorize, abort it, and assert
   * provider=google is present in the URL — no live Google navigation occurs.
   */
  test('Google sign-in button is present and initiates provider=google authorize request', async ({
    anonPage,
  }) => {
    test.setTimeout(120_000);

    let capturedAuthorizeUrl: string | null = null;

    // Intercept the browser navigation to Supabase /auth/v1/authorize and abort it
    await anonPage.route('**/auth/v1/authorize**', async (route) => {
      capturedAuthorizeUrl = route.request().url();
      await route.abort();
    });

    await anonPage.goto('/auth/sign-in', { timeout: 60_000 });

    // Button must be visible before any click
    const googleBtn = anonPage.getByRole('button', { name: '使用 Google 登入', exact: true });
    await expect(googleBtn).toBeVisible({ timeout: 60_000 });

    // Click — the Server Action fires, and the browser is redirected to Supabase /authorize.
    // The route intercept aborts that navigation; a navigation error is expected — swallow it.
    await Promise.race([
      googleBtn.click(),
      anonPage.waitForURL('**/auth/v1/authorize**', { timeout: 10_000 }).catch(() => {}),
    ]).catch(() => {});

    // Give the intercepted request a moment to be captured
    await anonPage.waitForTimeout(1_500);

    // The intercepted URL must include provider=google
    expect(capturedAuthorizeUrl).not.toBeNull();
    expect(capturedAuthorizeUrl).toContain('provider=google');
  });
});

test.describe('Auth — sign-in flow', () => {
  test('signs in through the UI and lands on the dashboard', async ({ anonPage }) => {
    // Supabase signInWithPassword and dashboard cold-compile can be slow in dev.
    test.setTimeout(120_000);

    const email = process.env.E2E_USER_EMAIL;
    const password = process.env.E2E_USER_PASSWORD;

    if (!email || !password) {
      throw new Error('E2E_USER_EMAIL and E2E_USER_PASSWORD must be set');
    }

    await anonPage.goto('/auth/sign-in', { timeout: 60_000 });

    await expect(anonPage.getByRole('heading', { name: '登入', exact: true })).toBeVisible({
      timeout: 60_000,
    });
    await expect(
      anonPage.getByRole('button', { name: '使用 Google 登入', exact: true })
    ).toBeVisible({
      timeout: 60_000,
    });

    await anonPage.getByLabel('電子郵件', { exact: true }).fill(email);
    await anonPage.getByLabel('密碼', { exact: true }).fill(password);

    await Promise.all([
      // Server Action → Supabase round-trip plus dashboard cold-compile can be slow in dev.
      anonPage.waitForURL(/\/dashboard(?:[/?#]|$)/, { timeout: 60_000 }),
      anonPage.getByRole('button', { name: '登入', exact: true }).click(),
    ]);

    await expect(anonPage).not.toHaveURL(/\/auth\/sign-in(?:[/?#]|$)/);
    await expect(anonPage).toHaveURL(/\/dashboard(?:[/?#]|$)/);
    await expect(anonPage.getByRole('heading', { name: '經營者主控台', exact: true })).toBeVisible({
      timeout: 60_000,
    });
    await expect(anonPage.getByText(`歡迎，${email.split('@')[0]}`, { exact: true })).toBeVisible({
      timeout: 60_000,
    });
  });
});
