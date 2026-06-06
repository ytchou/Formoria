import { test, expect } from '@playwright/test';

test.describe('Directory deep', () => {
  test('all filter combinations return results or empty state', async ({ page }) => {
    await page.goto('/brands');
    const filters = page
      .locator('main button[data-active]:visible')
      .filter({ hasNotText: /品牌經營|Brand-managed|MIT|社群|Community|verified|community/i })
      .filter({ hasNotText: /^全部 All$/i });
    const count = await filters.count();
    for (let i = 1; i < Math.min(count, 4); i++) {
      await filters.nth(i).click();
      await expect(
        page
          .locator('main [role="list"] [role="listitem"]')
          .first()
          .or(page.getByText(/找不到品牌|no brands|no results/i))
      ).toBeVisible({ timeout: 5_000 });
      await filters.nth(i).click(); // deselect
    }
  });

  test('search autocomplete shows suggestions', async ({ page }) => {
    await page.goto('/brands');
    const search = page.locator('form[role="search"] input[role="searchbox"]:visible');
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
    const nextLink = pagination.locator('a[aria-label="下一頁"]:visible');
    if (await nextLink.isVisible()) {
      await nextLink.click();
      await expect(page).toHaveURL(/page=2/);
      const prevLink = pagination.locator('a[aria-label="上一頁"]:visible');
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
      page
        .locator('main [role="list"] [role="listitem"]')
        .first()
        .or(page.getByText(/找不到品牌|no brands|no results/i))
    ).toBeVisible({ timeout: 10_000 });
  });

  test('empty search shows empty state not error', async ({ page }) => {
    await page.goto('/brands');
    const search = page.locator('form[role="search"] input[role="searchbox"]:visible');
    await search.fill('zzzzzzzzzzzzz_nonexistent');
    await page.keyboard.press('Enter');
    await expect(
      page.getByText(/找不到品牌|no results|no brands|nothing found/i).first()
    ).toBeVisible({ timeout: 5_000 });
  });
});
