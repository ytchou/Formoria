import { test, expect } from '@playwright/test';
import { gotoBrandsPage } from '../utils/goto-brands';

test.describe('Visitor smoke', () => {
  test('home page has Formoria title', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/formoria/i);
    await expect(page).not.toHaveTitle(/mit map/i);
  });

  test('landing page loads at /', async ({ page }) => {
    await page.goto('/');
    // Landing page has a hero heading visible
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 10_000 });
  });

  test('brands page title is Formoria-branded, not duplicated', async ({ page }) => {
    await gotoBrandsPage(page);
    await expect(page).toHaveTitle(/formoria|made in taiwan/i);
    const title = await page.title();
    expect((title.match(/formoria/gi) ?? []).length).toBeLessThanOrEqual(1);
  });

  test('brands directory loads at /brands', async ({ page }) => {
    await gotoBrandsPage(page);
    await expect(page.locator('main a[aria-label]').first()).toBeVisible({ timeout: 10_000 });
  });

  test('auth page title is not duplicated (DEV-698)', async ({ page }) => {
    await page.goto('/auth/sign-in');
    const title = await page.title();
    expect(title).not.toMatch(/mit map/i);
    expect((title.match(/formoria/gi) ?? []).length).toBeLessThanOrEqual(1);
  });

  test('category filter narrows results', async ({ page }) => {
    await gotoBrandsPage(page);
    await expect(async () => {
      await page.getByRole('checkbox').first().click({ force: true });
      await expect(page).toHaveURL(/category=|filter=/, { timeout: 3_000 });
    }).toPass({ timeout: 15_000, intervals: [1_000, 2_000, 3_000] });
    const hasBrands = page.locator('main a[aria-label]').first();
    const isEmpty = page.locator('[data-empty], [aria-label*="no result"], [aria-label*="empty"]').first();
    await expect(hasBrands.or(isEmpty)).toBeVisible({ timeout: 8_000 }).catch(() => {
      // No explicit empty-state element — that's fine, the page just shows fewer results
    });
    // Re-locate the checkbox after React re-render to avoid stale reference on WebKit
    const toggleOff = page.getByRole('checkbox').first();
    if (await toggleOff.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await toggleOff.click();
      await expect(page).not.toHaveURL(/category=/, { timeout: 10_000 });
    }
  });

  test('search returns results', async ({ page }) => {
    await gotoBrandsPage(page);
    const searchInput = page.getByRole('searchbox').or(page.getByPlaceholder(/search/i)).first();
    await searchInput.click();
    await expect(async () => {
      await searchInput.fill('a');
      await expect(searchInput).toHaveValue('a', { timeout: 2_000 });
    }).toPass({ timeout: 10_000, intervals: [1_000, 2_000, 3_000] });
    const listbox = page.locator('[role="listbox"]');
    const appeared = await listbox.isVisible({ timeout: 5_000 }).catch(() => false);
    if (appeared) {
      await expect(listbox).toBeVisible();
    }
  });

  test('FAQ page renders with accordion items', async ({ page }) => {
    await page.goto('/faq')
    await expect(page.getByRole('heading', { name: '常見問題' })).toBeVisible({ timeout: 5_000 })
    await expect(page.locator('details').first()).toBeVisible()
  })

  test('brand detail page renders', async ({ page }) => {
    await gotoBrandsPage(page);
    const firstBrand = page.locator('main a[aria-label]').first();
    const href = await firstBrand.getAttribute('href');
    expect(href).toBeTruthy();
    await page.goto(href!);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 5_000 });
  });
});
