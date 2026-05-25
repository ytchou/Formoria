import { test, expect } from '@playwright/test';

test.describe('Landing page smoke', () => {
  test('renders hero and search on /', async ({ page }) => {
    await page.goto('/');
    // Hero section heading visible
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 10_000 });
    // Search input present
    await expect(page.getByRole('searchbox')).toBeVisible();
  });

  test('search from landing page navigates to /brands?search=', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('searchbox').fill('coffee');
    await page.getByRole('searchbox').press('Enter');
    await expect(page).toHaveURL(/\/brands\?search=coffee/, { timeout: 15_000 });
  });
});
