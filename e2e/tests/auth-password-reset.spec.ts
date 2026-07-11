import { test, expect } from '../fixtures/auth';

// zh-TW copy from messages/zh-TW.json (auth.forgotPassword.* / auth.resetPassword.*)
const GENERIC_SUCCESS = '若此電子郵件已註冊帳號，我們已寄出密碼重設連結';
const SESSION_EXPIRED = '重設連結已過期，請重新申請';

test.describe('Auth — forgot password request', () => {
  test('sign-in page links to the forgot-password form', async ({ anonPage }) => {
    // Auth pages can cold-compile slowly in dev.
    test.setTimeout(120_000);

    await anonPage.goto('/auth/sign-in', { timeout: 60_000 });

    const forgotLink = anonPage.getByRole('link', { name: '忘記密碼？', exact: true });
    await expect(forgotLink).toBeVisible({ timeout: 60_000 });

    await Promise.all([
      anonPage.waitForURL(/\/auth\/forgot-password(?:[/?#]|$)/, { timeout: 60_000 }),
      forgotLink.click(),
    ]);

    await expect(
      anonPage.getByRole('heading', { name: '重設密碼', exact: true })
    ).toBeVisible({ timeout: 60_000 });
    await expect(anonPage.getByLabel('電子郵件', { exact: true })).toBeVisible();
    await expect(
      anonPage.getByRole('button', { name: '傳送重設連結', exact: true })
    ).toBeVisible();
  });

  test('empty or malformed email is blocked by validation — no success message', async ({
    anonPage,
  }) => {
    test.setTimeout(120_000);

    await anonPage.goto('/auth/forgot-password', { timeout: 60_000 });

    const emailInput = anonPage.getByLabel('電子郵件', { exact: true });
    const submitBtn = anonPage.getByRole('button', { name: '傳送重設連結', exact: true });
    await expect(emailInput).toBeVisible({ timeout: 60_000 });

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
    test.setTimeout(120_000);

    await anonPage.goto('/auth/forgot-password', { timeout: 60_000 });

    const emailInput = anonPage.getByLabel('電子郵件', { exact: true });
    await expect(emailInput).toBeVisible({ timeout: 60_000 });

    // Account does not exist — the message must be identical either way (anti-enumeration)
    await emailInput.fill(`e2e-nonexistent+${Date.now()}@example.com`);
    await anonPage.getByRole('button', { name: '傳送重設連結', exact: true }).click();

    await expect(anonPage.getByText(GENERIC_SUCCESS, { exact: true })).toBeVisible({
      timeout: 60_000,
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
    test.setTimeout(120_000);

    // Direct visit with no recovery session — the form must still render
    await anonPage.goto('/auth/reset-password', { timeout: 60_000 });

    await expect(
      anonPage.getByRole('heading', { name: '設定新密碼', exact: true })
    ).toBeVisible({ timeout: 60_000 });

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
    ).toBeVisible({ timeout: 60_000 });
    await expect(anonPage).toHaveURL(/\/auth\/reset-password(?:[/?#]|$)/);
    await expect(
      anonPage.getByRole('heading', { name: '設定新密碼', exact: true })
    ).toBeVisible();
    await expect(anonPage.getByText(/something went wrong|發生錯誤/i)).not.toBeVisible();
  });

  test('authenticated user is NOT bounced off the reset page (recovery session flow)', async ({
    userPage,
  }) => {
    test.setTimeout(120_000);

    // Regression: the auth layout used to redirect any authenticated user to
    // /dashboard, breaking the recovery flow (callback authenticates, then
    // sends the user here). The guard now lives on sign-in/sign-up/forgot-password
    // pages only — the reset form must render for a signed-in user.
    await userPage.goto('/auth/reset-password', { timeout: 60_000 });

    await expect(
      userPage.getByRole('heading', { name: '設定新密碼', exact: true })
    ).toBeVisible({ timeout: 60_000 });
    await expect(userPage).toHaveURL(/\/auth\/reset-password(?:[/?#]|$)/);
    await expect(userPage.getByLabel('新密碼', { exact: true })).toBeVisible();
    await expect(userPage.getByLabel('確認新密碼', { exact: true })).toBeVisible();
  });

  test('authenticated user visiting sign-in is still redirected to dashboard', async ({
    userPage,
  }) => {
    test.setTimeout(120_000);

    // Inverse sanity: moving the guard out of the layout must not drop it
    // from the sign-in page.
    await userPage.goto('/auth/sign-in', { timeout: 60_000 });
    await userPage.waitForURL(/\/dashboard/, { timeout: 60_000 });
  });
});
