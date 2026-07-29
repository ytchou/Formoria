import { test, expect } from '@playwright/test';
import { load } from 'cheerio';

function renderedDocument(html: string) {
  const $ = load(html);
  $('script, style, noscript').remove();

  return {
    lang: $('html').attr('lang'),
    headerText: $('header').text().replace(/\s+/g, ' ').trim(),
    mainText: $('main').text().replace(/\s+/g, ' ').trim(),
  };
}

/**
 * i18n: English browse journey
 *
 * Routing convention (next-intl, localePrefix: 'as-needed'):
 *   zh-TW (default) — prefix-free: /brands
 *   en               — under /en:   /en/brands
 *
 * The header LocaleSwitcher renders as a globe icon button:
 *   button "Switch language" (en) | "切換語言" (zh-TW)
 *   → menu with persisted locale actions for Traditional Chinese and English
 */
test.describe('i18n English browse', () => {
  test('/en declares the English locale in the initial HTTP document', async ({ request }) => {
    const response = await request.get('/en');

    expect(response.status()).toBe(200);
    const document = renderedDocument(await response.text());
    expect(document.lang).toBe('en');
  });

  test('/en/brands/djulis server-renders English chrome and taxonomy', async ({ request }) => {
    const response = await request.get('/en/brands/djulis');

    expect(response.status()).toBe(200);
    const document = renderedDocument(await response.text());
    expect(document.lang).toBe('en');

    for (const text of ['About Formoria', 'Submit a Brand']) {
      expect(document.headerText).toContain(text);
    }
    for (const text of [
      'Brand Directory',
      'Visit Website',
      'Brand information',
      'Location',
      'Founded',
      'Category',
      'Price',
      'Product categories',
      'Food & Beverage',
      'Snacks',
    ]) {
      expect(document.mainText).toContain(text);
    }
    for (const text of [
      '品牌目錄',
      '前往官網',
      '品牌資訊',
      '地點',
      '創立年份',
      '類別',
      '價格區間',
      '產品類別',
      '食品飲料',
      '零食',
    ]) {
      expect(document.mainText).not.toContain(text);
    }
  });

  test('/brands/djulis server-renders Traditional Chinese chrome and taxonomy', async ({
    request,
  }) => {
    const response = await request.get('/brands/djulis');

    expect(response.status()).toBe(200);
    const document = renderedDocument(await response.text());
    expect(document.lang).toBe('zh-TW');

    for (const text of ['關於 Formoria', '提交品牌']) {
      expect(document.headerText).toContain(text);
    }
    for (const text of [
      '品牌目錄',
      '前往官網',
      '品牌資訊',
      '地點',
      '創立年份',
      '類別',
      '價格區間',
      '產品類別',
      '食品飲料',
      '零食',
    ]) {
      expect(document.mainText).toContain(text);
    }
    for (const text of [
      'Brand Directory',
      'Visit Website',
      'Brand information',
      'Location',
      'Founded',
      'Category',
      'Product categories',
      'Food & Beverage',
      'Snacks',
    ]) {
      expect(document.mainText).not.toContain(text);
    }
  });

  test('/en/contributions preserves the localized return path when signed out', async ({ request }) => {
    const response = await request.get('/en/contributions', { maxRedirects: 0 });

    expect(response.status()).toBe(307);
    const location = new URL(response.headers().location, 'http://localhost');
    expect(location.pathname).toBe('/auth/sign-in');
    expect(location.searchParams.get('next')).toBe('/en/contributions');
  });

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
        .or(page.locator('[data-empty]').first())
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });

  test('LocaleSwitcher persists Traditional Chinese and returns to the equivalent route', async ({
    page,
  }) => {
    await page.goto('/en/brands');

    const switcherBtn = page.getByRole('banner').getByRole('button', { name: 'Switch language' });
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

    const switcherBtn = page.getByRole('banner').getByRole('button', { name: '切換語言' });
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
    const switcherBtn = page.getByRole('banner').getByRole('button', { name: '切換語言' });
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
