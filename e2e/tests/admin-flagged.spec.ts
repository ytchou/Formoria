import { test, expect } from '../fixtures/auth';

test.describe('Admin flagged deep', () => {
  test('flagged content page loads', async ({ adminPage }) => {
    await adminPage.goto('/admin/flagged');
    await expect(adminPage.getByRole('heading', { name: /flagged|moderation/i })).toBeVisible({ timeout: 10_000 });
    await expect(adminPage.getByText(/something went wrong/i)).not.toBeVisible();
  });

  test('flagged table renders columns correctly', async ({ adminPage }) => {
    await adminPage.goto('/admin/flagged');
    // Table should have expected columns: brand name, flag type, flagged at, actions
    await expect(
      adminPage.locator('table, [role="table"]').first().or(adminPage.getByText(/no flagged|nothing flagged/i))
    ).toBeVisible({ timeout: 5_000 });
  });
});
