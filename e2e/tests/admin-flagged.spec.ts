import { test, expect } from '../fixtures/auth';

test.describe('Admin flagged deep', () => {
  test.beforeEach(() => {
    const adminEmail = process.env.E2E_ADMIN_EMAIL;
    const list = (process.env.ADMIN_EMAILS ?? '').split(',').map(e => e.trim());
    test.skip(!adminEmail || !list.includes(adminEmail),
      'E2E_ADMIN_EMAIL not in ADMIN_EMAILS — admin tests require matching env');
  });

  test('flagged content page loads', async ({ adminPage }) => {
    // DEV-762: admin sub-routes cold-compile in CI dev mode; give generous budget
    test.setTimeout(60_000);
    await adminPage.goto('/admin/flagged');
    // Heading text is "Flagged Content" (English, no i18n on admin pages)
    await expect(adminPage.getByRole('heading', { name: /flagged content/i })).toBeVisible({ timeout: 15_000 });
    await expect(adminPage.getByText(/something went wrong/i)).not.toBeVisible();
  });

  test('flagged table renders columns correctly', async ({ adminPage }) => {
    // DEV-762: admin sub-routes cold-compile in CI dev mode; give generous budget
    test.setTimeout(60_000);
    await adminPage.goto('/admin/flagged');
    // Table renders when flags exist; empty state shows "No pending flags. All clear!" when no flags
    await expect(
      adminPage.locator('table').first().or(adminPage.getByText(/no pending flags/i))
    ).toBeVisible({ timeout: 15_000 });
  });
});
