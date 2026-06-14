import { test, expect } from '../fixtures/auth';

test.describe('Submit smoke', () => {
  test('wizard loads at /submit/form and URL step is visible', async ({ userPage }) => {
    await userPage.goto('/submit/form');

    // URL step renders with heading and URL input
    await expect(userPage.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 5_000 });
    await expect(userPage.locator('#website-url')).toBeVisible();

    // Auto-fill button is the primary CTA on the URL step (no skip in idle state)
    await expect(userPage.getByRole('button', { name: /自動填入|autoFill/i })).toBeVisible();
  });
});
