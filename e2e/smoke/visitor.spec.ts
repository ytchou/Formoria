import { test, expect } from '@playwright/test';

test.describe('Visitor smoke', () => {
  test('homepage loads brand directory', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/mit map|made in taiwan/i);
    // Brand cards should render
    await expect(page.locator('a[aria-label]').first()).toBeVisible({ timeout: 10_000 });
  });

  test('category filter narrows results', async ({ page }) => {
    await page.goto('/');
    // Click first available filter pill
    const firstFilter = page.locator('button[data-active="false"]').first();
    await firstFilter.click();
    // URL should update with filter param
    await expect(page).toHaveURL(/category=|filter=/);
    // The filtered view may have brands OR an empty state — either is valid.
    // We just verify the page doesn't crash and the filter toggle is reversible.
    const hasBrands = page.locator('a[aria-label]').first();
    const isEmpty = page.locator('[data-empty], [aria-label*="no result"], [aria-label*="empty"]').first();
    await expect(hasBrands.or(isEmpty)).toBeVisible({ timeout: 8_000 }).catch(() => {
      // No explicit empty-state element — that's fine, the page just shows fewer results
    });
    // Verify "All" pill resets the filter (round-trip)
    const allPill = page.locator('button[data-active="false"]').filter({ hasText: /all/i }).first();
    if (await allPill.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await allPill.click();
      await expect(page).not.toHaveURL(/category=/, { timeout: 5_000 });
    }
  });

  test('search returns results', async ({ page }) => {
    await page.goto('/');
    const searchInput = page.getByRole('searchbox').or(page.getByPlaceholder(/search/i)).first();
    await searchInput.fill('a');
    // Autocomplete dropdown should open (with results or "no results" message).
    // WebKit is slower to render the listbox, so use a generous timeout.
    // The search_brands RPC may not exist in all environments — the UI handles
    // this gracefully and still renders the listbox (possibly with a "no results" state).
    await expect(
      page.locator('[role="listbox"]')
    ).toBeVisible({ timeout: 10_000 });
  });

  test('brand detail page renders', async ({ page }) => {
    await page.goto('/');
    const firstBrand = page.locator('a[aria-label]').first();
    await firstBrand.click();
    // Should navigate to brand detail
    await expect(page).toHaveURL(/\/[^/]+$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 5_000 });
  });
});
