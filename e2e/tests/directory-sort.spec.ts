import { test, expect } from '@playwright/test';

test.describe('Directory sort deep', () => {
  test('selecting "A-Z" updates URL to ?sort=name', async ({ page }) => {
    await page.goto('/brands');

    const sortSelect = page.getByRole('combobox', { name: '排序方式' });
    await expect(sortSelect).toBeVisible({ timeout: 10_000 });
    await expect(sortSelect).toHaveValue('random');

    await sortSelect.selectOption('name');

    await expect(page).toHaveURL(/sort=name/, { timeout: 10_000 });
    await expect(page.locator('main a[aria-label]').first()).toBeVisible({ timeout: 10_000 });
  });

  test('selecting "最新" updates URL to ?sort=newest', async ({ page }) => {
    await page.goto('/brands');

    const sortSelect = page.getByRole('combobox', { name: '排序方式' });
    await expect(sortSelect).toBeVisible({ timeout: 10_000 });

    await sortSelect.selectOption('newest');

    await expect(page).toHaveURL(/sort=newest/, { timeout: 10_000 });
    await expect(page.locator('main a[aria-label]').first()).toBeVisible({ timeout: 10_000 });
  });

  test('selecting "創立年份" updates URL to ?sort=year', async ({ page }) => {
    await page.goto('/brands');

    const sortSelect = page.getByRole('combobox', { name: '排序方式' });
    await expect(sortSelect).toBeVisible({ timeout: 10_000 });

    await sortSelect.selectOption('year');

    await expect(page).toHaveURL(/sort=year/, { timeout: 10_000 });
    await expect(page.locator('main a[aria-label]').first()).toBeVisible({ timeout: 10_000 });
  });

  test('switching back to "隨機" removes sort param from URL', async ({ page }) => {
    await page.goto('/brands?sort=name');

    const sortSelect = page.getByRole('combobox', { name: '排序方式' });
    await expect(sortSelect).toBeVisible({ timeout: 10_000 });
    await expect(sortSelect).toHaveValue('name');

    await sortSelect.selectOption('random');

    await expect(page).not.toHaveURL(/sort=/, { timeout: 10_000 });
    await expect(page.locator('main a[aria-label]').first()).toBeVisible({ timeout: 10_000 });
  });

  test('navigating to ?sort=newest pre-selects "最新" in the selector', async ({ page }) => {
    await page.goto('/brands?sort=newest');

    const sortSelect = page.getByRole('combobox', { name: '排序方式' });
    await expect(sortSelect).toBeVisible({ timeout: 10_000 });
    await expect(sortSelect).toHaveValue('newest');
  });
});
