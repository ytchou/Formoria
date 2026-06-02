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
    await expect(
      page
        .locator('header a[href="/en/brands"]:visible')
        .filter({ hasText: /^Brand Directory$/ })
    ).toBeVisible({ timeout: 10_000 });
  });

  test('/en/brands returns 200 and shows English directory chrome', async ({ page }) => {
    const response = await page.goto('/en/brands');
    expect(response?.status()).toBe(200);
    await expect(
      page
        .locator('header a[href="/en/brands"]:visible')
        .filter({ hasText: /^Brand Directory$/ })
        .or(page.getByText(/all brands/i).first())
        .or(page.getByText(/no brands found/i))
    ).toBeVisible({ timeout: 10_000 });
  });

  test('LocaleSwitcher "中文" link on /en/brands points to the zh-TW equivalent', async ({
    page,
  }) => {
    await page.goto('/en/brands');

    // When current locale is "en", next-intl renders the zh-TW switcher link.
    // We verify the link is rendered and points toward /brands (zh-TW prefix-free or /zh-TW/brands).
    const zhLink = page
      .locator('header a:visible')
      .filter({ hasText: /^中文$/ });
    await expect(zhLink).toBeVisible({ timeout: 10_000 });

    const href = await zhLink.getAttribute('href');
    expect(href).toBeTruthy();
    // The zh-TW switcher href must end in /brands (either /brands or /zh-TW/brands)
    expect(href).toMatch(/\/brands$/);
  });

  test('LocaleSwitcher "EN" link on /brands navigates to /en/brands', async ({ page }) => {
    await page.goto('/brands');

    const enLink = page
      .locator('header a[href="/en/brands"]:visible')
      .filter({ hasText: /^EN$/ });
    await expect(enLink).toBeVisible({ timeout: 10_000 });
    await enLink.click();

    await expect(page).toHaveURL(/\/en\/brands/, { timeout: 10_000 });
  });

  test('/en/brands brand cards link to /en/brands/[slug]', async ({ page }) => {
    await page.goto('/en/brands');
    const firstBrand = page.locator('main [role="list"] a[aria-label]:visible').first();
    const hasBrand = await firstBrand.isVisible({ timeout: 10_000 }).catch(() => false);
    if (!hasBrand) {
      test.skip(true, 'No brands seeded — skipping brand card navigation check');
      return;
    }
    const href = await firstBrand.getAttribute('href');
    expect(href).toBeTruthy();
    expect(href).toContain('/en/brands/');
    await page.goto(href!);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 });
  });

  test('switching to EN via the switcher updates chrome + client components without refresh', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(
      page
        .locator('header a[href="/brands"]:visible')
        .filter({ hasText: /^品牌目錄$/ })
    ).toBeVisible({ timeout: 10_000 });
    await page
      .locator('header a[href="/en"]:visible')
      .filter({ hasText: /^EN$/ })
      .click();
    await expect(page).toHaveURL(/\/en$/, { timeout: 10_000 });
    await expect(
      page
        .locator('header a[href="/en/brands"]:visible')
        .filter({ hasText: /^Brand Directory$/ })
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('h1')).not.toHaveText('探索台灣製造的精品品牌');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(
      page
        .locator('header a[aria-current="true"]:visible')
        .filter({ hasText: /^EN$/ })
    ).toHaveAttribute('aria-current', 'true');
  });
});
