import { test, expect } from '@playwright/test';

test.describe('Visitor smoke', () => {
  test('homepage loads brand directory', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/mit map|made in taiwan/i);
    // Brand cards should render
    await expect(page.locator('[data-testid="brand-card"]').first()).toBeVisible({ timeout: 10_000 });
  });

  test('category filter narrows results', async ({ page }) => {
    await page.goto('/');
    // Click first available filter pill
    const firstFilter = page.locator('[data-testid="filter-pill"]').first();
    await firstFilter.click();
    // URL should update with filter param
    await expect(page).toHaveURL(/category=|filter=/);
    await expect(page.locator('[data-testid="brand-card"]').first()).toBeVisible({ timeout: 5_000 });
  });

  test('search returns results', async ({ page }) => {
    await page.goto('/');
    const searchInput = page.getByRole('searchbox').or(page.getByPlaceholder(/search/i)).first();
    await searchInput.fill('a');
    // Autocomplete dropdown or results should appear
    await expect(
      page.locator('[data-testid="autocomplete-item"], [data-testid="search-result"]').first()
    ).toBeVisible({ timeout: 5_000 });
  });

  test('brand detail page renders', async ({ page }) => {
    await page.goto('/');
    const firstBrand = page.locator('[data-testid="brand-card"]').first();
    await firstBrand.click();
    // Should navigate to brand detail
    await expect(page).toHaveURL(/\/[^/]+$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 5_000 });
  });
});
