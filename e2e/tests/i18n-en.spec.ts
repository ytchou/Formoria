import { test, expect } from '@playwright/test';

/**
 * i18n: English browse journey
 *
 * Routing convention (next-intl, localePrefix: 'as-needed'):
 *   zh-TW (default) — prefix-free: /brands
 *   en               — under /en:   /en/brands
 *
 * The LocaleSwitcher renders as a dropdown:
 *   button[aria-label="Switch language" | "切換語言"]
 *   → menu with menuitem "中文" (href /zh-TW/…) and menuitem "English" (href /en/…)
 */
test.describe('i18n English browse', () => {
  test('/en returns 200 and shows English header chrome', async ({ page }) => {
    const response = await page.goto('/en');
    expect(response?.status()).toBe(200);
    // Header renders "Submit a Brand" in English; html[lang] is "en"
    await expect(
      page.locator('header').getByRole('link', { name: 'Submit a Brand' })
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });

  test('/en/brands returns 200 and shows English directory chrome', async ({ page }) => {
    const response = await page.goto('/en/brands');
    expect(response?.status()).toBe(200);
    // The directory page renders brands in a list or an empty-state message
    await expect(
      page
        .locator('main [role="list"] [role="listitem"]')
        .first()
        .or(page.getByText(/no brands found/i))
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });

  test('LocaleSwitcher "中文" menuitem on /en/brands points to the zh-TW equivalent', async ({
    page,
  }) => {
    await page.goto('/en/brands');

    // The LocaleSwitcher is now a button + dropdown menu, not bare <a> links.
    const switcherBtn = page.getByRole('button', { name: 'Switch language' });
    await expect(switcherBtn).toBeVisible({ timeout: 10_000 });
    await switcherBtn.click();

    // When current locale is "en", the dropdown contains menuitem "中文" → /zh-TW/brands
    const zhItem = page.getByRole('menuitem', { name: '中文' });
    await expect(zhItem).toBeVisible({ timeout: 5_000 });

    const href = await zhItem.getAttribute('href');
    expect(href).toBeTruthy();
    // The zh-TW switcher href must end in /brands (zh-TW prefix or prefix-free)
    expect(href).toMatch(/\/brands$/);
  });

  test('LocaleSwitcher "English" menuitem on /brands navigates to /en/brands', async ({ page }) => {
    await page.goto('/brands');

    // The LocaleSwitcher is a button + dropdown — no bare <a href="/en/brands"> link.
    const switcherBtn = page.getByRole('button', { name: '切換語言' });
    await expect(switcherBtn).toBeVisible({ timeout: 10_000 });
    await switcherBtn.click();

    const enItem = page.getByRole('menuitem', { name: 'English' });
    await expect(enItem).toBeVisible({ timeout: 5_000 });
    await enItem.click();

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
    // The LocaleSwitcher is now a dropdown button, not bare <a> links.
    // Open the menu and click "English" to switch locale.
    const switcherBtn = page.getByRole('button', { name: '切換語言' });
    await expect(switcherBtn).toBeVisible({ timeout: 10_000 });
    await switcherBtn.click();
    const enItem = page.getByRole('menuitem', { name: 'English' });
    await expect(enItem).toBeVisible({ timeout: 5_000 });
    await enItem.click();
    await expect(page).toHaveURL(/\/en/, { timeout: 10_000 });
    // After switching: header submit link should be in English
    await expect(
      page.locator('header').getByRole('link', { name: 'Submit a Brand' })
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });
});
