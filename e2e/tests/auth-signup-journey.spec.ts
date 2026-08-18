import { createClient } from '@supabase/supabase-js';
import { test, expect } from '../fixtures/auth';
import {
  deleteSignupTestUsers,
  signupTestEmail,
} from '../helpers/signup-namespace';
import {
  capturedAuthLink,
  deleteCapturedAuthEmail,
  waitForCapturedAuthEmail,
} from '../helpers/auth-email-capture';
import { ownerFeaturesDisabled, OWNER_FEATURES_OFF_REASON } from '../helpers/owner-features';

import { BUDGET } from '../budgets';
// Signup → email confirmation → onboarding → first value.
//
// The journey MUST start from the real UI signup, not admin.createUser. signUp()
// runs through @supabase/ssr, which uses PKCE: it stores a code_verifier cookie in
// this browser context and a matching challenge server-side. Shortcutting the setup
// tests a different code path than the one real users take.
//
// The staging Send Email Hook captures the real Auth link without external
// delivery. This journey follows that link, so it exercises deployed Auth and
// the app callback rather than an admin-generated token shortcut.

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
    const email = signupTestEmail('journey', testInfo.workerIndex);
    const password = `SignupJourney${Date.now()}A!`;
    let userId: string | null = null;
    let captureId: string | null = null;
    const createdAfter = new Date().toISOString();

    try {
      // 1. Real UI signup — this is what establishes the PKCE verifier cookie in
      //    anonPage's context. Everything downstream depends on it.
      await anonPage.goto('/auth/sign-up');
      await anonPage.locator('#email').fill(email);
      await anonPage.locator('#password').fill(password);
      await anonPage.locator('#confirmPassword').fill(password);
      await anonPage.getByRole('button', { name: '建立帳號', exact: true }).click();

      const registered = await anonPage
        .waitForURL(/\/auth\/sign-in/, { timeout: BUDGET.SERVER_RENDER })
        .then(() => true)
        .catch(() => false);

      if (!registered) {
        const alertText = await anonPage
          .locator('[role="alert"]:not(#__next-route-announcer__)')
          .first()
          .textContent({ timeout: BUDGET.RENDERED })
          .catch(() => null);
        const observed = `url=${anonPage.url()} error=${alertText?.trim() || '(no error alert rendered)'}`;

        // Auth email quota exhaustion is an infrastructure failure. Do not
        // convert it into a skipped test or a green release gate.
        expect(observed, 'UI signup did not reach /auth/sign-in').toBe(
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

      // 2. Read the actual link captured by the staging Auth hook.
      const capture = await waitForCapturedAuthEmail({
        recipient: email,
        action: 'signup',
        createdAfter,
      });
      captureId = capture.id;

      // 3. Follow the captured URL through Supabase Auth into the app callback.
      await anonPage.goto(capturedAuthLink(capture));

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
      await expect(anonPage).toHaveURL(/\/dashboard\?.*is_new_user=1/, { timeout: BUDGET.GATED_UI });

      // 5. First value: the account with no brand yet sees the owner empty state
      //    with both onward CTAs. This is the payoff the whole funnel exists for.
      await expect(
        anonPage.getByRole('heading', { level: 1, name: '此頁面為品牌經營者專屬主控台' }),
      ).toBeVisible({ timeout: BUDGET.SERVER_RENDER });
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
          throw new Error(`[e2e-cleanup] journey user deletion failed: ${deleteError.message}`);
        }
      }
      await deleteCapturedAuthEmail(captureId);
      await deleteSignupTestUsers(undefined, { throwOnError: true });
    }
  });
});
