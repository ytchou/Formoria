import { test, expect } from '../fixtures/auth';

import { BUDGET } from '../budgets';
test.describe('Admin auth guards', () => {
  test('unauthenticated user is redirected from /admin', async ({ anonPage }) => {
    test.setTimeout(BUDGET.TEST.ADMIN);
    await anonPage.goto('/admin');
    await expect(anonPage).toHaveURL(/\/sign-in|\/login/i, { timeout: 60_000 });
  });

  test('unauthenticated user is redirected from /admin/submissions', async ({ anonPage }) => {
    test.setTimeout(BUDGET.TEST.ADMIN);
    await anonPage.goto('/admin/submissions');
    await expect(anonPage).toHaveURL(/\/sign-in|\/login/i, { timeout: 60_000 });
  });

  test('non-admin authenticated user is redirected from /admin', async ({ userPage }) => {
    test.setTimeout(BUDGET.TEST.ADMIN);
    await userPage.goto('/admin');
    // Should redirect to home or show forbidden, not render admin UI
    await expect(userPage).not.toHaveURL('/admin');
  });
});
