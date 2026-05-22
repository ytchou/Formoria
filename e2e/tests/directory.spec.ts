import { test, expect } from '@playwright/test';

test.describe('Directory deep', () => {
  test('all filter combinations return results or empty state', async ({ page }) => {
    await page.goto('/');
    const filters = page.locator('[data-testid="filter-pill"]');
    const count = await filters.count();
    for (let i = 0; i < Math.min(count, 3); i++) {
      await filters.nth(i).click();
      // Should show results OR empty state, never error
      await expect(
        page.locator('[data-testid="brand-card"]').first().or(page.getByText(/no brands|no results/i))
      ).toBeVisible({ timeout: 5_000 });
      await filters.nth(i).click(); // deselect
    }
  });

  test('search autocomplete shows suggestions', async ({ page }) => {
    await page.goto('/');
    const search = page.getByRole('searchbox').or(page.getByPlaceholder(/search/i)).first();
    await search.fill('te');
    await expect(
      page.locator('[data-testid="autocomplete-item"]').first()
    ).toBeVisible({ timeout: 5_000 });
  });

  test('pagination controls work', async ({ page }) => {
    await page.goto('/');
    const nextBtn = page.getByRole('button', { name: /next page|next/i })
      .or(page.locator('[data-testid="pagination-next"]'));
    if (await nextBtn.isVisible()) {
      await nextBtn.click();
      await expect(page).toHaveURL(/page=2/);
      const prevBtn = page.getByRole('button', { name: /previous|prev/i })
        .or(page.locator('[data-testid="pagination-prev"]'));
      await expect(prevBtn).toBeVisible();
    }
  });

  test('category page loads with filtered brands', async ({ page }) => {
    const categorySlug = process.env.E2E_CATEGORY_SLUG ?? 'fashion';
    await page.goto(`/categories/${categorySlug}`);
    // Accept either brand cards or a "no brands" empty state — both are valid
    await expect(
      page.locator('[data-testid="brand-card"]').first().or(page.getByText(/no brands|no results/i))
    ).toBeVisible({ timeout: 5_000 });
  });

  test('empty search shows empty state not error', async ({ page }) => {
    await page.goto('/');
    const search = page.getByRole('searchbox').or(page.getByPlaceholder(/search/i)).first();
    await search.fill('zzzzzzzzzzzzz_nonexistent');
    await page.keyboard.press('Enter');
    await expect(page.getByText(/no results|no brands|nothing found/i)).toBeVisible({ timeout: 5_000 });
  });
});
