import { test, expect } from '../fixtures/auth';

test.describe('Admin auth guards', () => {
  test('unauthenticated user is redirected from /admin', async ({ anonPage }) => {
    await anonPage.goto('/admin');
    await expect(anonPage).toHaveURL(/\/sign-in|\/login/i, { timeout: 10_000 });
  });

  test('unauthenticated user is redirected from /admin/review-queue/submissions', async ({ anonPage }) => {
    await anonPage.goto('/admin/review-queue/submissions');
    await expect(anonPage).toHaveURL(/\/sign-in|\/login/i, { timeout: 10_000 });
  });

  test('non-admin authenticated user is redirected from /admin', async ({ userPage }) => {
    await userPage.goto('/admin');
    // Should redirect to home or show forbidden, not render admin UI
    await expect(userPage).not.toHaveURL('/admin');
  });
});
