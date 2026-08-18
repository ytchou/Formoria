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

import { BUDGET } from '../budgets';
// Post-signup behavior per src/app/auth/actions.ts signUp():
//   supabase.auth.signUp() → redirect("/auth/sign-in?message=請到信箱點開確認連結，完成帳號驗證")
// The user is created in an unconfirmed state in Supabase; the UI shows a
// confirmation-required message on the sign-in page.

test.describe('Auth — sign-up flow', () => {
  const testPassword = 'TestPass1234!';

  // Generated inside the test: test.info() is unavailable at module scope.
  let signupEmail: string | null = null;

  test.afterAll(async () => {
    // Sweep the whole namespace, not just signupEmail — a crashed run would
    // otherwise leak an account that blocks the next run on "already registered".
    const deleted = await deleteSignupTestUsers(undefined, { throwOnError: true });
    if (signupEmail && deleted === 0) {
      throw new Error(`[e2e-cleanup] sign-up account was not swept: ${signupEmail}`);
    }
  });

  test('renders the sign-up form', async ({ anonPage }) => {
    await anonPage.goto('/auth/sign-up');

    await expect(anonPage.getByRole('heading', { name: '建立帳號', exact: true })).toBeVisible({
      timeout: BUDGET.INTERACTIVE,
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
    await expect(anonPage.getByText('密碼不一致')).toBeVisible({ timeout: BUDGET.INTERACTIVE });
  });

  test('shows validation error when password is too short', async ({ anonPage }) => {
    await anonPage.goto('/auth/sign-up');

    await anonPage.locator('#email').fill('short@test.local');
    await anonPage.locator('#password').fill('short');
    await anonPage.locator('#confirmPassword').fill('short');

    await anonPage.getByRole('button', { name: '建立帳號', exact: true }).click();

    // Zod min(8): "密碼至少需要 8 個字元"
    await expect(anonPage.getByText('密碼至少需要 8 個字元')).toBeVisible({ timeout: BUDGET.INTERACTIVE });
  });

  // A green run of this spec must
  // mean signup actually works — the previous version had an `else` branch that
  // accepted ANY inline error, so a permanent HTTP 400 (invalid email domain) read
  // as success and the spec could never go red during a signup outage.
  //
  test('registers a new user and redirects to sign-in with confirmation message', async ({
    anonPage,
  }) => {
    // Generous: the signup itself is ~15s, with a bounded capture poll after it.
    test.setTimeout(BUDGET.TEST.ADMIN);
    signupEmail = signupTestEmail('happy', test.info().workerIndex);
    const createdAfter = new Date().toISOString();
    let captureId: string | null = null;

    await anonPage.goto('/auth/sign-up');

    await anonPage.locator('#email').fill(signupEmail);
    await anonPage.locator('#password').fill(testPassword);
    await anonPage.locator('#confirmPassword').fill(testPassword);

    await anonPage.getByRole('button', { name: '建立帳號', exact: true }).click();

    // actions.ts happy path: redirect("/auth/sign-in?message=請到信箱點開確認連結，完成帳號驗證")
    const redirected = await anonPage
      .waitForURL(/\/auth\/sign-in/, { timeout: BUDGET.SERVER_RENDER })
      .then(() => true)
      .catch(() => false);

    if (redirected) {
      // Supabase accepted signup and the staging Send Email Hook captured the
      // real token. The signup journey follows this same link in its E2E flow.
      await expect(anonPage.getByText('請到信箱點開確認連結，完成帳號驗證')).toBeVisible({
        timeout: BUDGET.INTERACTIVE,
      });
      const capture = await waitForCapturedAuthEmail({
        recipient: signupEmail,
        action: 'signup',
        createdAfter,
      });
      captureId = capture.id;
      expect(capturedAuthLink(capture)).toContain('/auth/v1/verify?');
      await deleteCapturedAuthEmail(capture.id);
      captureId = null;
      return;
    }

    // The error div from sign-up-form.tsx: {state.error && <div role="alert">…</div>}
    // Filter out the empty Next.js route announcer which also has role="alert".
    const alertText = await anonPage
      .locator('[role="alert"]:not(#__next-route-announcer__)')
      .first()
      .textContent({ timeout: BUDGET.RENDERED })
      .catch(() => null);
    const observed = `url=${anonPage.url()} error=${alertText?.trim() || '(no error alert rendered)'}`;

    // A project-wide Auth email quota is an infrastructure failure, not an
    // acceptable skip: the release gate must remain fail-closed.
    expect(observed, 'sign-up did not reach /auth/sign-in').toBe(
      'redirected to /auth/sign-in with the confirmation message',
    );

    if (captureId) await deleteCapturedAuthEmail(captureId);
  });
});
