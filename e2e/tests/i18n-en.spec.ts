import { test, expect } from '@playwright/test';

/**
 * i18n: English browse journey
 *
 * Routing convention (next-intl, localePrefix: 'as-needed'):
 *   zh-TW (default) — prefix-free: /brands, /categories/…
 *   en               — under /en:   /en/brands, /en/categories/…
 *
 * The LocaleSwitcher renders:
 *   <a href="…">中文</a> / <a href="…">EN</a>
 */
test.describe('i18n English browse', () => {
  test('/en returns 200 and shows English nav label', async ({ page }) => {
    const response = await page.goto('/en');
    expect(response?.status()).toBe(200);
    // nav.brandDirectory = "Brand Directory" in en.json
    await expect(
      page.getByRole('link', { name: /brand directory/i })
    ).toBeVisible({ timeout: 10_000 });
  });

  test('/en/brands returns 200 and shows English directory chrome', async ({ page }) => {
    const response = await page.goto('/en/brands');
    expect(response?.status()).toBe(200);
    // brands.metadata.title contains "Brand Directory" / common.allBrands = "All Brands"
    // We check for an English string present in en.json brands.* or nav.*
    await expect(
      page
        .getByRole('link', { name: /brand directory/i })
        .or(page.getByText(/all brands/i).first())
        .or(page.getByText(/no brands found/i))
    ).toBeVisible({ timeout: 10_000 });
  });

  test('LocaleSwitcher "中文" link on /en/brands navigates to prefix-free zh-TW equivalent', async ({
    page,
  }) => {
    await page.goto('/en/brands');

    // The LocaleSwitcher renders a link with text "中文"
    const zhLink = page.getByRole('link', { name: '中文' });
    await expect(zhLink).toBeVisible({ timeout: 10_000 });
    await zhLink.click();

    // After switching to zh-TW, the URL should be the prefix-free /brands (no /en/ segment)
    await expect(page).toHaveURL(/\/brands$/, { timeout: 10_000 });
    expect(page.url()).not.toContain('/en/');

    // Chinese chrome should now be visible — e.g. 找不到品牌 on empty state or brand cards
    // We only assert the page loaded without error (title check is sufficient)
    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);
  });

  test('LocaleSwitcher "EN" link on /brands navigates to /en/brands', async ({ page }) => {
    await page.goto('/brands');

    const enLink = page.getByRole('link', { name: 'EN' });
    await expect(enLink).toBeVisible({ timeout: 10_000 });
    await enLink.click();

    // After switching to en, the URL should be under /en/
    await expect(page).toHaveURL(/\/en\/brands/, { timeout: 10_000 });
  });

  test('/en/brands brand cards link to /en/brands/[slug]', async ({ page }) => {
    await page.goto('/en/brands');
    // Wait for at least one brand card link (same aria-label pattern as visitor.spec.ts)
    const firstBrand = page.locator('main a[aria-label]').first();
    const hasBrand = await firstBrand.isVisible({ timeout: 10_000 }).catch(() => false);
    if (!hasBrand) {
      test.skip(true, 'No brands seeded — skipping brand card navigation check');
      return;
    }
    const href = await firstBrand.getAttribute('href');
    expect(href).toBeTruthy();
    // Brand detail links under /en should include /en/ prefix
    expect(href).toContain('/en/brands/');
    await page.goto(href!);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 });
  });

  test('switching to EN via the switcher updates chrome + client components without refresh', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: '品牌目錄' })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('link', { name: 'EN', exact: true }).click();
    await expect(page).toHaveURL(/\/en$/, { timeout: 10_000 });
    await expect(page.getByRole('link', { name: /brand directory/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('h1')).not.toHaveText('探索台灣製造的精品品牌');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('link', { name: 'EN', exact: true })).toHaveAttribute('aria-current', 'true');
  });
});
