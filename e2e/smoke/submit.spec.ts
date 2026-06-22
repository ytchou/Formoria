import { test, expect } from '../fixtures/auth';

test.describe('Submit smoke', () => {
  test('submit form loads at /submit/form and URL phase is visible', async ({ userPage }) => {
    await userPage.goto('/submit/form');

    // Page-level heading "提交品牌" and the URL input from the URL discovery phase
    await expect(userPage.getByRole('heading', { name: '提交品牌', exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(userPage.locator('#website-url')).toBeVisible();

    // Auto-fill button is always visible in idle state
    await expect(userPage.getByRole('button', { name: /自動填入/i })).toBeVisible();

    // Skip button is also present in idle state (single phase, no step indicator)
    await expect(userPage.getByRole('button', { name: '跳過，手動填寫', exact: true })).toBeVisible();

    // No step indicator — the form is a single screen, not a wizard
    await expect(userPage.locator('[data-state="active"]')).not.toBeVisible();
  });
});
