import { test, expect } from '../fixtures/auth';

test.describe('Submit smoke', () => {
  test('wizard loads and skip-to-form works', async ({ userPage }) => {
    await userPage.goto('/submit');

    // URL step renders with heading and URL input
    await expect(userPage.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 5_000 });
    await expect(userPage.locator('input[type="url"]')).toBeVisible();

    // Skip URL scraping to enter the multi-step form
    await userPage.getByRole('button', { name: /skip|跳過/i }).click();

    // Step 1 (Brand Info) loads with form fields
    await expect(userPage.locator('#brand-name')).toBeVisible({ timeout: 5_000 });
    await expect(userPage.locator('#brand-description')).toBeVisible();

    // Fill fields to verify form interactivity
    await userPage.locator('#brand-name').fill('[E2E-TEST] Smoke Brand');
    await userPage.locator('#brand-description').fill('Smoke test brand description with enough detail');
    await expect(userPage.locator('#brand-name')).toHaveValue('[E2E-TEST] Smoke Brand');
    await expect(userPage.locator('#brand-description')).toHaveValue(
      'Smoke test brand description with enough detail',
    );
  });
});
