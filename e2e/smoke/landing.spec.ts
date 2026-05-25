import { test, expect } from '@playwright/test';

test.describe('Landing page smoke', () => {
  test('renders hero, category nav, and search on /', async ({ page }) => {
    await page.goto('/');
    // Hero section heading visible
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 10_000 });
    // Search input present
    await expect(page.getByRole('searchbox')).toBeVisible();
    // At least one category nav tab
    const categoryLinks = page.locator('a[href*="/brands?category="]');
    await expect(categoryLinks.first()).toBeVisible({ timeout: 10_000 });
  });

  test('category tab navigates to /brands?category=<slug>', async ({ page }) => {
    await page.goto('/');
    const firstCategoryLink = page.locator('a[href*="/brands?category="]').first();
    await firstCategoryLink.waitFor({ state: 'visible', timeout: 10_000 });
    const href = await firstCategoryLink.getAttribute('href');
    await firstCategoryLink.click();
    await expect(page).toHaveURL(href!);
  });

  test('search from landing page navigates to /brands?search=', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('searchbox').fill('coffee');
    await page.getByRole('searchbox').press('Enter');
    await expect(page).toHaveURL(/\/brands\?search=coffee/);
  });
});
