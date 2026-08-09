import { test, expect } from '../fixtures/auth';
import {
  deleteSignupTestUsers,
  isEmailRateLimitMessage,
  signupTestEmail,
} from '../helpers/signup-namespace';
import { waitForDelivery } from '../helpers/resend-delivery';

import { BUDGET } from '../budgets';
// Post-signup behavior per src/app/auth/actions.ts signUp():
//   supabase.auth.signUp() → redirect("/auth/sign-in?message=請確認您的電子郵件以完成帳號驗證")
// The user is created in an unconfirmed state in Supabase; the UI shows a
// confirmation-required message on the sign-in page.

test.describe('Auth — sign-up flow', () => {
  const testPassword = 'TestPass1234!';

  // Generated inside the test: test.info() is unavailable at module scope.
  let signupEmail: string | null = null;

  test.afterAll(async () => {
    // Sweep the whole namespace, not just signupEmail — a crashed run would
    // otherwise leak an account that blocks the next run on "already registered".
    const deleted = await deleteSignupTestUsers();
    if (signupEmail && deleted === 0) {
      console.warn(`[e2e-cleanup] sign-up account was not swept: ${signupEmail}`);
    }
  });

  test('renders the sign-up form', async ({ anonPage }) => {
    await anonPage.goto('/auth/sign-up');

    await expect(anonPage.getByRole('heading', { name: '建立帳號', exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await expect(anonPage.locator('#email')).toBeVisible();
    await expect(anonPage.locator('#password')).toBeVisible();
    await expect(anonPage.locator('#confirmPassword')).toBeVisible();
    await expect(anonPage.getByRole('button', { name: '建立帳號', exact: true })).toBeVisible();
  });

  test('shows validation error when passwords do not match', async ({ anonPage }) => {
    await anonPage.goto('/auth/sign-up');

    await anonPage.locator('#email').fill('mismatch@test.local');
    await anonPage.locator('#password').fill('TestPass1234!');
    await anonPage.locator('#confirmPassword').fill('DifferentPass!');

    await anonPage.getByRole('button', { name: '建立帳號', exact: true }).click();

    // Zod refine: "密碼不一致"
    await expect(anonPage.getByText('密碼不一致')).toBeVisible({ timeout: 10_000 });
  });

  test('shows validation error when password is too short', async ({ anonPage }) => {
    await anonPage.goto('/auth/sign-up');

    await anonPage.locator('#email').fill('short@test.local');
    await anonPage.locator('#password').fill('short');
    await anonPage.locator('#confirmPassword').fill('short');

    await anonPage.getByRole('button', { name: '建立帳號', exact: true }).click();

    // Zod min(8): "密碼至少需要 8 個字元"
    await expect(anonPage.getByText('密碼至少需要 8 個字元')).toBeVisible({ timeout: 10_000 });
  });

  // Three outcomes, and only one of them is a pass. A green run of this spec must
  // mean signup actually works — the previous version had an `else` branch that
  // accepted ANY inline error, so a permanent HTTP 400 (invalid email domain) read
  // as success and the spec could never go red during a signup outage.
  //
  // The only tolerated non-pass is the Supabase project-wide email quota (429):
  // that is infrastructure we do not control, not an app defect. It is recorded as
  // a SKIP so the run is visibly incomplete rather than falsely green. Everything
  // else — an invalid-email 400, an empty error, a silent no-op — is a FAIL.
  //
  // Reaching the redirect only proves Supabase ACCEPTED the message. When
  // E2E_RESEND_API_KEY is present the test goes further and asserts the message was
  // actually delivered — see the delivery block below and helpers/resend-delivery.ts.
  test('registers a new user and redirects to sign-in with confirmation message', async ({
    anonPage,
  }) => {
    // Generous: the signup itself is ~15s, the delivery poll up to 60s more.
    test.setTimeout(BUDGET.TEST.ADMIN);
    signupEmail = signupTestEmail('happy', test.info().workerIndex);

    await anonPage.goto('/auth/sign-up');

    await anonPage.locator('#email').fill(signupEmail);
    await anonPage.locator('#password').fill(testPassword);
    await anonPage.locator('#confirmPassword').fill(testPassword);

    await anonPage.getByRole('button', { name: '建立帳號', exact: true }).click();

    // actions.ts happy path: redirect("/auth/sign-in?message=請確認您的電子郵件以完成帳號驗證")
    const redirected = await anonPage
      .waitForURL(/\/auth\/sign-in/, { timeout: 15_000 })
      .then(() => true)
      .catch(() => false);

    if (redirected) {
      // (1) Success — Supabase accepted the sign-up and created the unconfirmed user.
      await expect(anonPage.getByText('請確認您的電子郵件以完成帳號驗證')).toBeVisible({
        timeout: 10_000,
      });

      // (1b) …but acceptance is not delivery. Supabase Auth sends through Resend
      // (custom SMTP), so Resend is the only place the real outcome is visible.
      // Without the key this assertion is inert — adding E2E_RESEND_API_KEY to the
      // workflow is the deliberate switch that turns it on.
      const resendApiKey = process.env.E2E_RESEND_API_KEY;
      if (!resendApiKey) return;

      const outcome = await waitForDelivery(signupEmail, { apiKey: resendApiKey });

      if (outcome.status === 'unobservable') {
        // Resend refused the credential (needs read access for GET /emails, which
        // a sending-only key does not have). That says nothing about whether the
        // message was delivered, so failing here would assert something this test
        // never established — and it would take the whole production synthetic
        // suite down with it. Same treatment as the quota case below: visibly
        // incomplete, never falsely green. Tracked on DEV-1380.
        test.skip(
          true,
          `Resend rejected the API key (HTTP ${outcome.httpStatus}) — delivery to ${signupEmail} could not be observed; rotate RESEND_API_KEY to a full-access key (DEV-1380)`,
        );
        return;
      }

      if (outcome.status === 'pending') {
        // Still in flight after the poll window. Genuinely unknown, not a defect —
        // same treatment as the quota case: visibly incomplete, never falsely green.
        test.skip(
          true,
          `confirmation email to ${signupEmail} still in flight (last_event=${outcome.lastEvent})`,
        );
        return;
      }

      // A bounce here is the DEV-1300 failure mode reproducing: green signup,
      // dead mailbox, sending reputation quietly burning.
      expect(
        outcome.status === 'not_found'
          ? `no Resend record for ${signupEmail}`
          : `last_event=${outcome.lastEvent}`,
        `confirmation email to ${signupEmail} was not delivered`,
      ).toBe('last_event=delivered');
      return;
    }

    // The error div from sign-up-form.tsx: {state.error && <div role="alert">…</div>}
    // Filter out the empty Next.js route announcer which also has role="alert".
    const alertText = await anonPage
      .locator('[role="alert"]:not(#__next-route-announcer__)')
      .first()
      .textContent({ timeout: 5_000 })
      .catch(() => null);
    const observed = `url=${anonPage.url()} error=${alertText?.trim() || '(no error alert rendered)'}`;

    if (isEmailRateLimitMessage(alertText)) {
      // (2) Supabase's project-wide email quota is exhausted. It is not per-address,
      // so a fresh namespace cannot dodge it — skip rather than fail or pass.
      test.skip(true, `Supabase project-wide email quota exhausted — ${observed}`);
      return;
    }

    // (3) Signup is broken. Fail loudly, carrying what was actually observed.
    expect(observed, 'sign-up did not reach /auth/sign-in and was not email rate limited').toBe(
      'redirected to /auth/sign-in with the confirmation message',
    );
  });
});
