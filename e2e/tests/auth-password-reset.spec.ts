import { test, expect } from '../fixtures/auth';
import { createClient } from '@supabase/supabase-js';
import { capturedAuthLink, deleteCapturedAuthEmail, waitForCapturedAuthEmail } from '../helpers/auth-email-capture';
import { signupTestEmail } from '../helpers/signup-namespace';

import { BUDGET } from '../budgets';
// zh-TW copy from messages/zh-TW.json (auth.forgotPassword.* / auth.resetPassword.*)
const GENERIC_SUCCESS = '若此電子郵件已註冊帳號，我們已寄出密碼重設連結';
const SESSION_EXPIRED = '重設連結已過期，請重新申請';

test.describe('Auth — forgot password request', () => {
  test('follows a captured recovery link and updates the password', async ({ anonPage }, testInfo) => {
    test.setTimeout(BUDGET.TEST.JOURNEY);
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const email = signupTestEmail('recovery', testInfo.workerIndex);
    const password = `Recovery-${Date.now()}A!`;
    const createdAfter = new Date().toISOString();
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    expect(createError?.message ?? null).toBeNull();
    const createdUserId = created.user?.id;
    expect(createdUserId).toBeTruthy();
    let captureId: string | null = null;
    try {
      await anonPage.goto('/auth/forgot-password');
      await anonPage.getByLabel('電子郵件', { exact: true }).fill(email);
      await anonPage.getByRole('button', { name: '傳送重設連結', exact: true }).click();
      await expect(anonPage.getByText(GENERIC_SUCCESS, { exact: true })).toBeVisible({
        timeout: BUDGET.NAVIGATION,
      });

      const capture = await waitForCapturedAuthEmail({
        recipient: email,
        action: 'recovery',
        createdAfter,
      });
      captureId = capture.id;
      await anonPage.goto(capturedAuthLink(capture));
      await anonPage.waitForURL(/\/auth\/reset-password/, { timeout: BUDGET.NAVIGATION });
      const nextPassword = `Recovery-updated-${Date.now()}A!`;
      await anonPage.getByLabel('新密碼', { exact: true }).fill(nextPassword);
      await anonPage.getByLabel('確認新密碼', { exact: true }).fill(nextPassword);
      await anonPage.getByRole('button', { name: '更新密碼', exact: true }).click();
      await expect(anonPage.getByText(/密碼已更新|password updated/i)).toBeVisible({
        timeout: BUDGET.NAVIGATION,
      });
    } finally {
      const cleanupErrors = (await Promise.all([
        deleteCapturedAuthEmail(captureId)
          .then(() => null)
          .catch((error: unknown) => error instanceof Error ? error.message : String(error)),
        admin.auth.admin.deleteUser(createdUserId!).then(({ error }) => error?.message ?? null),
      ])).filter(Boolean);
      expect(cleanupErrors, 'recovery journey cleanup must remove every resource').toEqual([]);
    }
  });

  test('sign-in page links to the forgot-password form', async ({ anonPage }) => {
    // `sign-in-form.tsx` renders the forgot-password link only when
    // `NEXT_PUBLIC_DEPLOYMENT_ENV !== "staging"`, so on the one environment this
    // suite is allowed to target the link under test does not exist. Only the
    // LINK is hidden — `/auth/forgot-password` itself still serves on staging,
    // which is why the validation test below this one keeps running there.
    test.skip(
      process.env.FORMORIA_DEPLOYMENT_ENV === 'staging',
      'staging hides the Google button and the forgot-password link',
    );
    // Auth pages can cold-compile slowly in dev.
    test.setTimeout(BUDGET.TEST.ADMIN);
    await anonPage.goto('/auth/sign-in');

    const forgotLink = anonPage.getByRole('link', { name: '忘記密碼？', exact: true });
    await expect(forgotLink).toBeVisible({ timeout: BUDGET.NAVIGATION });

    await Promise.all([
      anonPage.waitForURL(/\/auth\/forgot-password(?:[/?#]|$)/),
      forgotLink.click(),
    ]);

    await expect(
      anonPage.getByRole('heading', { name: '重設密碼', exact: true })
    ).toBeVisible({ timeout: BUDGET.NAVIGATION });
    await expect(anonPage.getByLabel('電子郵件', { exact: true })).toBeVisible();
    await expect(
      anonPage.getByRole('button', { name: '傳送重設連結', exact: true })
    ).toBeVisible();
  });

  test('empty or malformed email is blocked by validation — no success message', async ({
    anonPage,
  }) => {
    test.setTimeout(BUDGET.TEST.ADMIN);
    await anonPage.goto('/auth/forgot-password');

    const emailInput = anonPage.getByLabel('電子郵件', { exact: true });
    const submitBtn = anonPage.getByRole('button', { name: '傳送重設連結', exact: true });
    await expect(emailInput).toBeVisible({ timeout: BUDGET.NAVIGATION });

    // Empty submit: native constraint validation (required) blocks the request
    await submitBtn.click();
    expect(
      await emailInput.evaluate((el: HTMLInputElement) => el.validity.valueMissing)
    ).toBe(true);

    // Malformed email: native constraint validation (type=email) blocks the request
    await emailInput.fill('not-an-email');
    await submitBtn.click();
    expect(
      await emailInput.evaluate((el: HTMLInputElement) => el.validity.typeMismatch)
    ).toBe(true);

    // Neither attempt was submitted — form intact, no success message shown
    await expect(anonPage).toHaveURL(/\/auth\/forgot-password(?:[/?#]|$)/);
    await expect(anonPage.getByText(GENERIC_SUCCESS)).not.toBeVisible();
    await expect(emailInput).toBeVisible();
  });

  test('well-formed unknown email gets the generic anti-enumeration success message', async ({
    anonPage,
  }) => {
    // Server Action → Supabase round-trip can be slow in dev.
    test.setTimeout(BUDGET.TEST.ADMIN);
    await anonPage.goto('/auth/forgot-password');

    const emailInput = anonPage.getByLabel('電子郵件', { exact: true });
    await expect(emailInput).toBeVisible({ timeout: BUDGET.NAVIGATION });

    // Account does not exist — the message must be identical either way (anti-enumeration)
    await emailInput.fill(`e2e-nonexistent+${Date.now()}@example.com`);
    await anonPage.getByRole('button', { name: '傳送重設連結', exact: true }).click();

    await expect(anonPage.getByText(GENERIC_SUCCESS, { exact: true })).toBeVisible({
      timeout: BUDGET.NAVIGATION,
    });
    // Success state replaces the form
    await expect(emailInput).not.toBeVisible();
    // Still on the forgot-password page, no error surfaced
    // (exclude Next.js's route announcer, which also has role="alert")
    await expect(anonPage).toHaveURL(/\/auth\/forgot-password(?:[/?#]|$)/);
    await expect(
      anonPage.getByRole('alert').and(anonPage.locator(':not(#__next-route-announcer__)'))
    ).not.toBeVisible();
  });
});

test.describe('Auth — reset password page guard', () => {
  test('reset page without a recovery session fails gracefully with session-expired error', async ({
    anonPage,
  }) => {
    test.setTimeout(BUDGET.TEST.ADMIN);
    // Direct visit with no recovery session — the form must still render
    await anonPage.goto('/auth/reset-password');

    await expect(
      anonPage.getByRole('heading', { name: '設定新密碼', exact: true })
    ).toBeVisible({ timeout: BUDGET.NAVIGATION });

    const passwordInput = anonPage.getByLabel('新密碼', { exact: true });
    const confirmInput = anonPage.getByLabel('確認新密碼', { exact: true });
    await expect(passwordInput).toBeVisible();
    await expect(confirmInput).toBeVisible();

    // Submit a valid new password (≥8 chars, matching confirm)
    const newPassword = `E2e-reset-${Date.now()}`;
    await passwordInput.fill(newPassword);
    await confirmInput.fill(newPassword);
    await anonPage.getByRole('button', { name: '更新密碼', exact: true }).click();

    // Translated session-expired error — graceful, no crash / error boundary
    // (filter out Next.js's route announcer, which also has role="alert")
    await expect(
      anonPage.getByRole('alert').filter({ hasText: SESSION_EXPIRED })
    ).toBeVisible({ timeout: BUDGET.NAVIGATION });
    await expect(anonPage).toHaveURL(/\/auth\/reset-password(?:[/?#]|$)/);
    await expect(
      anonPage.getByRole('heading', { name: '設定新密碼', exact: true })
    ).toBeVisible();
    await expect(anonPage.getByText(/something went wrong|發生錯誤/i)).not.toBeVisible();
  });

  test('authenticated user is NOT bounced off the reset page (recovery session flow)', async ({
    userPage,
  }) => {
    test.setTimeout(BUDGET.TEST.ADMIN);
    // Regression: the auth layout used to redirect any authenticated user away
    // from this page, breaking the recovery flow (callback authenticates, then
    // sends the user here). The guard now lives on sign-in/sign-up/forgot-password
    // pages only — the reset form must render for a signed-in user.
    await userPage.goto('/auth/reset-password');

    await expect(
      userPage.getByRole('heading', { name: '設定新密碼', exact: true })
    ).toBeVisible({ timeout: BUDGET.NAVIGATION });
    await expect(userPage).toHaveURL(/\/auth\/reset-password(?:[/?#]|$)/);
    await expect(userPage.getByLabel('新密碼', { exact: true })).toBeVisible();
    await expect(userPage.getByLabel('確認新密碼', { exact: true })).toBeVisible();
  });

  test('authenticated user visiting sign-in is still redirected away', async ({
    userPage,
  }) => {
    test.setTimeout(BUDGET.TEST.ADMIN);
    // Inverse sanity: moving the guard out of the layout must not drop it
    // from the sign-in page. The destination depends on the owner-features flag
    // (DEV-1261) — `/` while owner features are off — so assert only that the
    // guard fired and the user did not stay on the sign-in page.
    await userPage.goto('/auth/sign-in');
    await userPage.waitForURL((url) => !url.pathname.includes('/auth/sign-in'));
    await expect(userPage.getByRole('button', { name: /account|帳號/i })).toBeVisible({
      timeout: BUDGET.GATED_UI,
    });
  });
});
