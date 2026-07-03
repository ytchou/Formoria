import { test, expect } from '@playwright/test';

test.describe('Stats page', () => {
  // Navigate once per test; SSR may be slow on first hit in dev (ISR revalidate = 3600s)
  test.beforeEach(async ({ page }) => {
    await page.goto('/stats');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 });
  });

  test('page title contains brand statistics keyword', async ({ page }) => {
    // zh-TW title: "台灣品牌數據 | Formoria"
    await expect(page).toHaveTitle(/數據|Statistics/);
  });

  test('hero section displays total brand count', async ({ page }) => {
    // zh-TW: "追蹤 {count} 個品牌" — observable as text containing 個品牌
    await expect(page.getByText(/個品牌/).first()).toBeVisible();
  });

  test('category breakdown section renders with at least one category link', async ({ page }) => {
    // h2 "類別分布" is always present
    await expect(page.getByRole('heading', { level: 2, name: '類別分布' })).toBeVisible();
    // Category rows are <a> links pointing to /brands?category=...
    const categoryLinks = page.locator('main a[href*="category"]');
    const linkCount = await categoryLinks.count();
    expect(linkCount).toBeGreaterThan(0);
  });

  test('MIT verified section displays a percentage value', async ({ page }) => {
    // h2 "MIT 認證" confirms the section rendered
    await expect(page.getByRole('heading', { level: 2, name: 'MIT 認證' })).toBeVisible();
    // The card shows the percentage as "{n}%"
    await expect(page.locator('main').getByText(/\d+%/).first()).toBeVisible();
  });

  test('emits Article JSON-LD in page source', async ({ page }) => {
    const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
    expect(blocks.some((b) => b.includes('"Article"'))).toBe(true);
  });
});
