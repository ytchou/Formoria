import { test, expect } from '../fixtures/auth';

import { BUDGET, POLL } from '../budgets';

const PASSWORD_MISMATCH = '兩次輸入的密碼不一致';

test.describe('Auth — sign-up interrupted request', () => {
  for (const { locale, prefix, message } of [
    { locale: 'zh-TW', prefix: '', message: '暫時無法完成，請再試一次。' },
    { locale: 'en', prefix: '/en', message: 'Unable to complete the request. Please try again.' },
  ]) {
    test(`a dropped sign-up request preserves fields and consent for retry (${locale})`, async ({ anonPage }) => {
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
        await anonPage.goto(`${prefix}/auth/sign-up?email=${encodeURIComponent('m.garcia+invited@company.invalid')}`);
        const form = anonPage.getByRole('main').locator('form');
        const email = form.locator('input[name="email"]');
        const password = form.locator('input[name="password"]');
        const confirm = form.locator('input[name="confirmPassword"]');
        const consent = form.getByRole('checkbox');
        const submit = form.locator('button[type="submit"]');
        const alert = anonPage.getByRole('main').getByRole('alert');
        await expect(email).toHaveValue('m.garcia+invited@company.invalid');
        await email.fill('m.garcia+transport@company.invalid');
        await password.fill('Synthetic retry input 2026');
        await confirm.fill('Synthetic retry input 2026');
        await consent.check();
        await submit.click();
        await expect(submit).toBeDisabled();
        await expect.poll(() => attempts).toBe(1);
        await confirm.press('Enter');
        expect(attempts).toBe(1);
        release();
        await expect(alert).toHaveText(message);
        await expect(submit).toBeEnabled();
        await expect(alert).toBeFocused();
        await expect(email).toHaveValue('m.garcia+transport@company.invalid');
        await expect(password).toHaveValue('Synthetic retry input 2026');
        await expect(confirm).toHaveValue('Synthetic retry input 2026');
        await expect(consent).toBeChecked();
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
});

test.describe('Auth — sign-up flow', () => {
  test('renders the sign-up form', async ({ anonPage }) => {
    await anonPage.goto('/auth/sign-up');

    await expect(anonPage.getByRole('heading', { name: '建立帳號', exact: true })).toBeVisible({
      timeout: BUDGET.INTERACTIVE,
    });
    await expect(anonPage.locator('#email')).toBeVisible();
    await expect(anonPage.locator('#password')).toBeVisible();
    await expect(anonPage.locator('#confirmPassword')).toBeVisible();
    // The length rule is persistent helper text, not a placeholder that
    // disappears on focus.
    await expect(anonPage.locator('#password-hint')).toHaveText('至少 8 個字元');
    await expect(anonPage.locator('#confirmPassword')).not.toHaveAttribute('placeholder');
    await expect(anonPage.getByRole('button', { name: '建立帳號', exact: true })).toBeVisible();
  });

  test('shows validation error when passwords do not match', async ({ anonPage }) => {
    await anonPage.goto('/auth/sign-up');

    const confirm = anonPage.locator('#confirmPassword');
    await anonPage.locator('#email').fill('mismatch@test.local');
    await anonPage.locator('#password').fill('TestPass1234!');
    await confirm.fill('DifferentPass!');

    // Blur validation runs client-side, so it needs React hydrated: retry the
    // idempotent blur rather than guessing a hydration delay.
    await expect(async () => {
      await confirm.focus();
      await confirm.blur();
      await expect(confirm).toHaveAttribute('aria-invalid', 'true', {
        timeout: BUDGET.INTERACTIVE,
      });
    }).toPass(POLL.UI);
    await expect(anonPage.locator('#confirmPassword-error')).toHaveText(PASSWORD_MISMATCH);

    await anonPage.getByRole('button', { name: '建立帳號', exact: true }).click();

    // Zod refine, returned by the server action as the form-level error.
    await expect(
      anonPage.getByRole('alert').filter({ hasText: PASSWORD_MISMATCH })
    ).toBeVisible({ timeout: BUDGET.INTERACTIVE });
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
});
