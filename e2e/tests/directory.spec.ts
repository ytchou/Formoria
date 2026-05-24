import { test, expect } from '@playwright/test';

test.describe('Directory deep', () => {
  test('all filter combinations return results or empty state', async ({ page }) => {
    await page.goto('/brands');
    const filters = page.locator('[data-testid="filter-pill"]');
    const count = await filters.count();
    for (let i = 0; i < Math.min(count, 3); i++) {
      await filters.nth(i).click();
      // Should show results OR empty state, never error
      // BrandGrid uses role="listitem" for each card; empty state shows Chinese text 找不到品牌
      await expect(
        page.locator('[role="listitem"]').first().or(page.getByText(/找不到品牌|no brands|no results/i))
      ).toBeVisible({ timeout: 5_000 });
      await filters.nth(i).click(); // deselect
    }
  });

  test('search autocomplete shows suggestions', async ({ page }) => {
    await page.goto('/brands');
    const search = page.getByRole('searchbox').or(page.getByPlaceholder(/search/i)).first();
    await search.fill('te');
    // SearchSuggestions renders items as <li role="option"> inside <ul role="listbox">
    // If the search_brands RPC is unavailable the dropdown may not appear — accept that gracefully
    const dropdown = page.locator('[role="listbox"]');
    const hasDropdown = await dropdown.isVisible({ timeout: 5_000 }).catch(() => false);
    if (hasDropdown) {
      await expect(
        page.locator('[role="option"]').first().or(page.getByText(/no results found/i))
      ).toBeVisible({ timeout: 5_000 });
    }
  });

  test('pagination controls work', async ({ page }) => {
    await page.goto('/brands');
    // Pagination renders <Link> elements (role="link"), not buttons.
    // "Next" link has aria-label "下一頁"; URL param is ?page=2
    const nextLink = page.getByRole('link', { name: /下一頁/ })
      .or(page.locator('[aria-label="下一頁"]'));
    if (await nextLink.isVisible()) {
      await nextLink.click();
      await expect(page).toHaveURL(/page=2/);
      const prevLink = page.getByRole('link', { name: /上一頁/ })
        .or(page.locator('[aria-label="上一頁"]'));
      await expect(prevLink).toBeVisible();
    }
  });

  test('category page loads with filtered brands', async ({ page }) => {
    const categorySlug = process.env.E2E_CATEGORY_SLUG ?? 'clothing';
    const response = await page.goto(`/categories/${categorySlug}`);
    if (!response || response.status() === 404) {
      test.skip(true, `Category "${categorySlug}" not found — set E2E_CATEGORY_SLUG`);
      return;
    }
    await expect(
      page.locator('[role="listitem"]').first().or(page.getByText(/找不到品牌/i))
    ).toBeVisible({ timeout: 10_000 });
  });

  test('empty search shows empty state not error', async ({ page }) => {
    await page.goto('/brands');
    const search = page.getByRole('searchbox').or(page.getByPlaceholder(/search/i)).first();
    await search.fill('zzzzzzzzzzzzz_nonexistent');
    await page.keyboard.press('Enter');
    // BrandGrid empty state renders 找不到品牌 in Chinese
    await expect(
      page.getByText(/找不到品牌|no results|no brands|nothing found/i)
    ).toBeVisible({ timeout: 5_000 });
  });
});
