import { test, expect } from '@playwright/test';

test.describe('Landing page smoke', () => {
  test('renders hero and search on /', async ({ page }) => {
    await page.goto('/');
    // Hero section heading visible
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 10_000 });
    // Search input present (moved inside HeroSection but still findable by role)
    await expect(page.getByRole('searchbox')).toBeVisible();
  });

  test('search from landing page navigates to /brands?search=', async ({ page }) => {
    await page.goto('/');
    const searchbox = page.getByRole('searchbox');
    await searchbox.click();
    // Use pressSequentially instead of fill() — fill() does not reliably
    // trigger React onChange on controlled inputs in WebKit.
    await searchbox.pressSequentially('coffee', { delay: 50 });
    await searchbox.press('Enter');
    await expect(page).toHaveURL(/\/brands\?search=coffee/, { timeout: 15_000 });
  });
});
