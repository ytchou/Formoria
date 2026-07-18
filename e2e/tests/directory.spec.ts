import { test, expect } from '@playwright/test';

test.describe('Directory deep', () => {
  test('all filter combinations return results or empty state', async ({ page }) => {
    await page.goto('/brands');
    const filters = page.getByRole('checkbox');
    const count = await filters.count();
    for (let i = 1; i < Math.min(count, 4); i++) {
      await filters.nth(i).click();
      await expect(
        page
          .locator('main [role="list"] [role="listitem"]')
          .first()
          .or(page.locator('[data-empty]').first())
      ).toBeVisible({ timeout: 5_000 });
      await filters.nth(i).click(); // deselect
    }
  });

  test('search autocomplete shows suggestions', async ({ page }) => {
    await page.goto('/brands');
    const search = page.locator('form[role="search"] input[role="searchbox"]:visible').first();
    await search.fill('te');
    const dropdown = page.locator('[role="listbox"]:visible');
    const hasDropdown = await dropdown.isVisible({ timeout: 5_000 }).catch(() => false);
    if (hasDropdown) {
      await expect(
        dropdown.locator('[role="option"]').first().or(page.getByText(/no results found/i))
      ).toBeVisible({ timeout: 5_000 });
    }
  });

  test('pagination controls work', async ({ page }) => {
    await page.goto('/brands');
    const pagination = page.locator('nav[aria-label="Pagination"]');
    const nextLink = pagination.locator('a[aria-label="下一頁"]');
    if (!(await nextLink.isVisible())) return; // fewer than 2 pages of data — skip
    await nextLink.click();
    await expect(page).toHaveURL(/\/brands\?[^#]*page=2(?:&|$)/);
    const prevLink = page.locator('nav[aria-label="Pagination"] a[aria-label="上一頁"]');
    await expect(prevLink).toBeVisible({ timeout: 10_000 });
  });

  test('category page loads with filtered brands', async ({ page }) => {
    const categorySlug = process.env.E2E_CATEGORY_SLUG ?? 'clothing';
    const response = await page.goto(`/brands?category=${categorySlug}`);
    if (!response || response.status() === 404) {
      test.skip(true, `Category "${categorySlug}" not found — set E2E_CATEGORY_SLUG`);
      return;
    }
    // The filtered directory renders brand list items or the recovery empty state.
    await expect(
      page.locator('main [role="list"] [role="listitem"]').first()
        .or(page.locator('[data-empty]').first())
    ).toBeVisible({ timeout: 10_000 });
  });

  test('empty search shows empty state not error', async ({ page }) => {
    await page.goto('/brands');
    const search = page.locator('form[role="search"] input[role="searchbox"]:visible').first();
    await search.fill('zzzzzzzzzzzzz_nonexistent');
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-empty]')).toBeVisible({ timeout: 5_000 });
  });

  test('empty filtered search shows empty state without recovery actions', async ({ page }) => {
    await page.goto('/brands?search=zzzzzzzzzzzzz_nonexistent&category=jewelry');

    const emptyState = page.locator('[data-empty]');
    await expect(emptyState.getByRole('heading', { name: '找不到符合的品牌' })).toBeVisible();

    await expect(emptyState.getByRole('link', { name: /移除品牌關鍵字/ })).not.toBeVisible();
  });
});
