import { test, expect } from '../fixtures/auth';

test.describe('Auth — sign-in flow', () => {
  test('signs in through the UI and lands on the dashboard', async ({ anonPage }) => {
    const email = process.env.E2E_USER_EMAIL;
    const password = process.env.E2E_USER_PASSWORD;

    if (!email || !password) {
      throw new Error('E2E_USER_EMAIL and E2E_USER_PASSWORD must be set');
    }

    await anonPage.goto('/auth/sign-in');

    await expect(anonPage.getByRole('heading', { name: '登入', exact: true })).toBeVisible({
      timeout: 10_000,
    });

    await anonPage.getByLabel('電子郵件', { exact: true }).fill(email);
    await anonPage.getByLabel('密碼', { exact: true }).fill(password);

    await Promise.all([
      anonPage.waitForURL(/\/dashboard(?:[/?#]|$)/, { timeout: 15_000 }),
      anonPage.getByRole('button', { name: '登入', exact: true }).click(),
    ]);

    await expect(anonPage).not.toHaveURL(/\/auth\/sign-in(?:[/?#]|$)/);
    await expect(anonPage).toHaveURL(/\/dashboard(?:[/?#]|$)/);
    await expect(anonPage.getByRole('heading', { name: '品牌管理', exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await expect(anonPage.getByText(`歡迎，${email}`, { exact: true })).toBeVisible({
      timeout: 10_000,
    });
  });
});
