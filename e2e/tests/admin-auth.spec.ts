import { test, expect } from '../fixtures/auth';

test.describe('Admin auth guards', () => {
  test('unauthenticated user is redirected from /admin', async ({ anonPage }) => {
    test.setTimeout(120_000);

    await anonPage.goto('/admin', { timeout: 60_000 });
    await expect(anonPage).toHaveURL(/\/sign-in|\/login/i, { timeout: 60_000 });
  });

  test('unauthenticated user is redirected from /admin/review-queue/submissions', async ({ anonPage }) => {
    test.setTimeout(120_000);

    await anonPage.goto('/admin/review-queue/submissions', { timeout: 60_000 });
    await expect(anonPage).toHaveURL(/\/sign-in|\/login/i, { timeout: 60_000 });
  });

  test('non-admin authenticated user is redirected from /admin', async ({ userPage }) => {
    test.setTimeout(120_000);

    await userPage.goto('/admin', { timeout: 60_000 });
    // Should redirect to home or show forbidden, not render admin UI
    await expect(userPage).not.toHaveURL('/admin');
  });
});
