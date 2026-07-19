import { test, expect } from '@playwright/test';
import { gotoBrandsPage } from '../utils/goto-brands';

test.describe('Directory sort smoke', () => {
  test('default sort at /brands is "隨機" (random) with no sort param', async ({ page }) => {
    await gotoBrandsPage(page);

    const sortSelect = page.getByRole('combobox', { name: '排序方式' });
    await expect(sortSelect).toBeVisible({ timeout: 10_000 });

    await expect(sortSelect).toHaveValue('random');

    expect(page.url()).not.toContain('sort=');

    await expect(page.locator('main a[aria-label]').first()).toBeVisible({ timeout: 10_000 });
  });
});
