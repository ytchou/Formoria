import { createClient } from '@supabase/supabase-js';
import { test, expect } from '../fixtures/auth';
import {
  deleteSignupTestUsers,
  isEmailRateLimitMessage,
  signupTestEmail,
} from '../helpers/signup-namespace';
import { ownerFeaturesDisabled, OWNER_FEATURES_OFF_REASON } from '../helpers/owner-features';

import { BUDGET } from '../budgets';
// Signup → email confirmation → onboarding → first value.
//
// The journey MUST start from the real UI signup, not admin.createUser. signUp()
// runs through @supabase/ssr, which uses PKCE: it stores a code_verifier cookie in
// this browser context and a matching challenge server-side. Shortcutting the setup
// tests a different code path than the one real users take.
//
// Confirming the account can't go through that same PKCE exchange, though.
// admin.generateLink() has no code_challenge parameter (see @supabase/auth-js'
// GenerateLinkOptions) — a link it mints can never satisfy the PKCE flow_state the
// real signUp() created, so /auth/v1/verify falls back to the implicit flow and
// hands back tokens in the URL *fragment*, which /auth/callback's `?code=` reader
// never sees. This was confirmed directly against the project's auth API: signing
// up for real and then minting a link with generateLink still redirects with
// `#access_token=…`, never `?code=`. Reading the real confirmation email isn't a
// fix either — formoria.com is a Cloudflare Email Routing catch-all → Drop, so that
// mail is discarded, not delivered anywhere retrievable.
//
// So confirmation goes through /auth/callback's `test_token_hash` fallback instead
// (PLAYWRIGHT_TEST-gated, see route.ts): generateLink's `hashed_token` verifies via
// supabase.auth.verifyOtp(), the same call a real email-OTP confirmation would use.
// That still exercises the callback's full onboarding handoff — new-user detection,
// locale, redirect — just via the OTP branch instead of the PKCE code-exchange one.
//
// Cost of doing it properly: signUp sends a confirmation email, so this journey is
// gated by Supabase's PROJECT-WIDE email quota (429). That quota is not per-address,
// so no namespace can dodge it. When it is exhausted the journey SKIPS — never
// passes — for the same reason as auth-signup.spec.ts.

test.describe.serial('Auth — signup to first value', () => {
  test.skip(!process.env.SUPABASE_SERVICE_ROLE_KEY, 'requires service role key');

  // Suite-level gate (DEV-1261). The confirmation callback lands new users on
  // `/` instead of `/dashboard` while the flag is off, so the owner-dashboard
  // payoff this journey verifies is unreachable. Probes the running app, never
  // app_settings.
  test.beforeAll(async ({ browser }) => {
    if (await ownerFeaturesDisabled(browser)) {
      test.skip(true, OWNER_FEATURES_OFF_REASON);
    }
  });

  test('confirms a new account and lands on the owner dashboard empty state', async ({
    anonPage,
    baseURL,
  }, testInfo) => {
    test.setTimeout(BUDGET.TEST.JOURNEY);
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );

    expect(baseURL, 'baseURL must be configured').toBeTruthy();
    // Strip a trailing slash so a `vars.PRODUCTION_BASE_URL` ending in `/`
    // cannot produce a `//auth/callback` redirectTo that fails Supabase's
    // allow-list match.
    const callbackUrl = `${baseURL!.replace(/\/$/, '')}/auth/callback`;

    const email = signupTestEmail('journey', testInfo.workerIndex);
    const password = `SignupJourney${Date.now()}A!`;
    let userId: string | null = null;

    try {
      // 1. Real UI signup — this is what establishes the PKCE verifier cookie in
      //    anonPage's context. Everything downstream depends on it.
      await anonPage.goto('/auth/sign-up');
      await anonPage.locator('#email').fill(email);
      await anonPage.locator('#password').fill(password);
      await anonPage.locator('#confirmPassword').fill(password);
      await anonPage.getByRole('button', { name: '建立帳號', exact: true }).click();

      const registered = await anonPage
        .waitForURL(/\/auth\/sign-in/, { timeout: 15_000 })
        .then(() => true)
        .catch(() => false);

      if (!registered) {
        const alertText = await anonPage
          .locator('[role="alert"]:not(#__next-route-announcer__)')
          .first()
          .textContent({ timeout: 5_000 })
          .catch(() => null);
        const observed = `url=${anonPage.url()} error=${alertText?.trim() || '(no error alert rendered)'}`;

        if (isEmailRateLimitMessage(alertText)) {
          test.skip(true, `Supabase project-wide email quota exhausted — ${observed}`);
          return;
        }
        expect(observed, 'UI signup did not reach /auth/sign-in and was not rate limited').toBe(
          'redirected to /auth/sign-in with the confirmation message',
        );
      }

      // Resolve the account signUp just created so teardown can always reach it.
      const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const createdUser = list?.users?.find((u) => u.email === email) ?? null;
      expect(createdUser, 'signUp must have created the account').not.toBeNull();
      userId = createdUser!.id;
      expect(
        createdUser!.email_confirmed_at ?? null,
        'the journey must start from an UNCONFIRMED account',
      ).toBeNull();

      // 2. Mint the confirmation token in place of reading an inbox (dropped by the
      //    Cloudflare catch-all) or an actual PKCE-compatible link, which
      //    generateLink cannot produce — see the module comment above.
      const { data: link, error: linkError } = await admin.auth.admin.generateLink({
        type: 'signup',
        email,
        password,
        options: { redirectTo: callbackUrl },
      });
      expect(linkError?.message ?? null, 'admin.generateLink must succeed').toBeNull();
      const tokenHash = link.properties?.hashed_token;
      expect(tokenHash, 'generateLink must return a hashed_token').toBeTruthy();

      // 3. Confirm through /auth/callback's test-only OTP fallback (PLAYWRIGHT_TEST-
      //    gated, see route.ts) instead of clicking the link. Same browser context
      //    as step 1; the confirmation itself goes through verifyOtp rather than the
      //    PKCE exchange, but everything downstream in the callback is identical.
      await anonPage.goto(`${callbackUrl}?test_token_hash=${encodeURIComponent(tokenHash!)}`);

      // 4. Onboarding handoff — callback marks a <60s-old account as new and sends
      //    it to the zh-TW dashboard (bare path, localePrefix: 'as-needed').
      //    A landing on ?error=expired-code means verifyOtp rejected the token — say
      //    so rather than emitting a bare URL-mismatch, because the two failures
      //    have different causes.
      if (/[?&]error=/.test(anonPage.url())) {
        expect(
          `callback rejected the confirmation token: ${anonPage.url()}`,
          'confirmation token did not complete the OTP verification',
        ).toBe('/dashboard?is_new_user=1');
      }
      await expect(anonPage).toHaveURL(/\/dashboard\?.*is_new_user=1/, { timeout: 30_000 });

      // 5. First value: the account with no brand yet sees the owner empty state
      //    with both onward CTAs. This is the payoff the whole funnel exists for.
      await expect(
        anonPage.getByRole('heading', { level: 1, name: '此頁面為品牌經營者專屬主控台' }),
      ).toBeVisible({ timeout: 15_000 });
      await expect(anonPage.getByRole('link', { name: '提交你的品牌' })).toHaveAttribute(
        'href',
        /\/submit$/,
      );
      await expect(anonPage.getByRole('link', { name: '瀏覽品牌目錄' })).toHaveAttribute(
        'href',
        /\/brands$/,
      );

      // 6. The confirmation actually stuck server-side — not just a client redirect.
      const { data: refreshed, error: fetchError } = await admin.auth.admin.getUserById(userId);
      expect(fetchError?.message ?? null, 'admin.getUserById must succeed').toBeNull();
      expect(
        refreshed.user?.email_confirmed_at ?? null,
        'the account must be confirmed after following the link',
      ).not.toBeNull();
    } finally {
      if (userId) {
        const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
        if (deleteError) {
          console.warn(`[e2e-cleanup] journey user deletion failed: ${deleteError.message}`);
        }
      }
      await deleteSignupTestUsers();
    }
  });
});
