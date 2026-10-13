import { test, expect } from '../fixtures/auth';
import { createClient } from '@supabase/supabase-js';
import { isStagingEnvironment } from '../../src/lib/deployment-environment';
import { isCanonicalStagingTarget } from '../helpers/staging-session';

import { BUDGET } from '../budgets';
// zh-TW copy from messages/zh-TW.json (auth.forgotPassword.* / auth.resetPassword.*)
const SESSION_EXPIRED = '重設連結已過期，請重新寄一次。';

test.describe('Auth — password recovery interrupted request', () => {
  for (const { locale, prefix, message } of [
    { locale: 'zh-TW', prefix: '', message: '暫時無法完成，請再試一次。' },
    { locale: 'en', prefix: '/en', message: 'Unable to complete the request. Please try again.' },
  ]) {
    for (const kind of ['forgot-password', 'reset-password']) {
      test(`a dropped ${kind} request preserves fields for retry (${locale})`, async ({ anonPage }) => {
        let release = () => {};
        const held = new Promise<void>((resolve) => { release = resolve; });
        let attempts = 0;
        await anonPage.route('**/*', async (route) => {
          if (route.request().method() !== 'POST') return route.continue();
          if (route.request().headers()['next-action']) attempts++;
          await held;
          await route.abort('failed');
        });
        try {
          await anonPage.goto(`${prefix}/auth/${kind}`);
          const form = anonPage.getByRole('main').locator('form');
          const fields = form.locator('input[name="email"],input[type="password"]');
          const inputs = await fields.all();
          for (const field of inputs) {
            const name = await field.getAttribute('name');
            await field.fill(name === 'email' ? 'm.garcia+transport@company.invalid' : 'Synthetic retry input 2026');
          }
          const submit = form.locator('button[type="submit"]');
          const alert = anonPage.getByRole('main').getByRole('alert');
          await submit.click();
          await expect(submit).toBeDisabled();
          await expect.poll(() => attempts).toBe(1);
          await fields.last().press('Enter');
          expect(attempts).toBe(1);
          release();
          await expect(alert).toHaveText(message);
          await expect(submit).toBeEnabled();
          await expect(alert).toBeFocused();
          for (const field of inputs) {
            const name = await field.getAttribute('name');
            await expect(field).toHaveValue(name === 'email' ? 'm.garcia+transport@company.invalid' : 'Synthetic retry input 2026');
          }
          await submit.click();
          await expect.poll(() => attempts).toBe(2);
          await expect(submit).toBeEnabled();
          await expect(alert).toHaveText(message);
          await expect(alert).toBeFocused();
        } finally {
          release();
        }
      });
    }
  }
});

test.describe('Auth — forgot password request', () => {
  const baseURL =
    process.env.BASE_URL ??
    process.env.PLAYWRIGHT_BASE_URL ??
    process.env.STAGING_BASE_URL;
  const localStaging =
    isStagingEnvironment() &&
    (!baseURL || !isCanonicalStagingTarget(baseURL));
  if (localStaging) {
    test('local staging keeps credential sign-in without password recovery', async ({ anonPage }) => {
      await anonPage.goto('/auth/sign-in');
      await expect(anonPage.getByRole('link', { name: '忘記密碼？', exact: true })).toHaveCount(0);
      await expect(anonPage.getByLabel('電子郵件', { exact: true })).toBeVisible();
      await expect(anonPage.getByLabel('密碼', { exact: true })).toBeVisible();
    });
  } else {
    test('sign-in page links to the forgot-password form', async ({ anonPage }) => {
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
  }

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
    await expect(emailInput).toBeVisible();
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
    await expect(anonPage.getByText(/something went wrong|this page didn't load|發生錯誤|頁面沒有正常載入/i)).not.toBeVisible();
  });

  test('authenticated isolated user updates their password from the reset page', async ({
    isolatedUserPage,
    isolatedUser,
  }) => {
    test.setTimeout(BUDGET.TEST.MUTATION);
    await isolatedUserPage.goto('/auth/reset-password');

    await expect(
      isolatedUserPage.getByRole('heading', { name: '設定新密碼', exact: true })
    ).toBeVisible({ timeout: BUDGET.NAVIGATION });
    await expect(isolatedUserPage).toHaveURL(/\/auth\/reset-password(?:[/?#]|$)/);

    const nextPassword = `IsolatedReset${Date.now()}A!`;
    await isolatedUserPage.getByLabel('新密碼', { exact: true }).fill(nextPassword);
    await isolatedUserPage
      .getByLabel('確認新密碼', { exact: true })
      .fill(nextPassword);
    await isolatedUserPage
      .getByRole('button', { name: '更新密碼', exact: true })
      .click();

    await expect(
      isolatedUserPage.getByText('密碼已更新，請用新密碼登入。', { exact: true })
    ).toBeVisible({ timeout: BUDGET.NAVIGATION });

    const verifier = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data, error } = await verifier.auth.signInWithPassword({
      email: isolatedUser.email,
      password: nextPassword,
    });
    expect(error?.message ?? null).toBeNull();
    expect(data.user?.id).toBe(isolatedUser.id);
    await verifier.auth.signOut();
  });

  test('authenticated user visiting sign-in is still redirected away', async ({
    userPage,
  }) => {
    test.setTimeout(BUDGET.TEST.ADMIN);
    // Inverse sanity: moving the guard out of the layout must not drop it
    // from the sign-in page. An authenticated visitor lands on `/`, so assert
    // only that the guard fired and the user did not stay on the sign-in page.
    await userPage.goto('/auth/sign-in');
    await userPage.waitForURL((url) => !url.pathname.includes('/auth/sign-in'));
    await expect(userPage.getByRole('button', { name: /account|帳號/i })).toBeVisible({
      timeout: BUDGET.GATED_UI,
    });
  });
});
