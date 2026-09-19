import { test, expect } from '../fixtures/auth';

import { BUDGET } from '../budgets';

test.describe('Auth — sign-up flow', () => {
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

});
