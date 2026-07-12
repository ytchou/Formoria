import { test, expect } from '@playwright/test';

/**
 * i18n: English browse journey
 *
 * Routing convention (next-intl, localePrefix: 'as-needed'):
 *   zh-TW (default) — prefix-free: /brands
 *   en               — under /en:   /en/brands
 *
 * The LocaleSwitcher renders as a compact dropdown (visible text = current locale name):
 *   button "English" (en) | "繁體中文" (zh-TW)
 *   → menu with persisted locale actions for Traditional Chinese and English
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

  test('LocaleSwitcher persists Traditional Chinese and returns to the equivalent route', async ({
    page,
  }) => {
    await page.goto('/en/brands');

    // Compact LocaleSwitcher shows current locale name as visible text.
    const switcherBtn = page.getByRole('banner').getByRole('button', { name: 'English' });
    await expect(switcherBtn).toBeVisible({ timeout: 10_000 });
    await switcherBtn.click();

    const zhItem = page.getByRole('menuitem', { name: 'Traditional Chinese' });
    await expect(zhItem).toBeVisible({ timeout: 5_000 });
    await zhItem.click();

    await expect(page).toHaveURL(/\/brands$/, { timeout: 10_000 });
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-TW');
    await expect.poll(async () =>
      (await page.context().cookies()).find((cookie) => cookie.name === 'NEXT_LOCALE')?.value,
    ).toBe('zh-TW');
  });

  test('LocaleSwitcher "English" menuitem on /brands navigates to /en/brands', async ({ page }) => {
    await page.goto('/brands');

    // Compact LocaleSwitcher shows current locale name as visible text.
    const switcherBtn = page.getByRole('banner').getByRole('button', { name: '繁體中文' });
    await expect(switcherBtn).toBeVisible({ timeout: 10_000 });
    await switcherBtn.click();

    const enItem = page.getByRole('menuitem', { name: 'English' });
    await expect(enItem).toBeVisible({ timeout: 5_000 });
    await enItem.click();

    await expect(page).toHaveURL(/\/en\/brands/, { timeout: 10_000 });
  });

  test('/en/brands brand cards link to /en/brands/[slug]', async ({ page }) => {
    await page.goto('/en/brands');
    const firstBrand = page.locator('main [role="list"] article a[href*="/brands/"]').first();
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
    // Compact LocaleSwitcher shows current locale name as visible text.
    const switcherBtn = page.getByRole('banner').getByRole('button', { name: '繁體中文' });
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
