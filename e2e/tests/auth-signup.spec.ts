import { test, expect } from '../fixtures/auth';

import { BUDGET, POLL } from '../budgets';

const PASSWORD_MISMATCH = '兩次輸入的密碼不一致';

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
