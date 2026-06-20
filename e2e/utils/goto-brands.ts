import { type Page, expect } from '@playwright/test';

/**
 * Navigate to /brands and wait for the page to be interactive.
 *
 * Uses `domcontentloaded` to avoid WebKit's slow `load` event (blocked by
 * images), then waits for a React-hydrated element (sort combobox value)
 * as a reliable signal that client JS has executed.
 */
export async function gotoBrandsPage(page: Page): Promise<void> {
  await page.goto('/brands', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('main a[aria-label]').first()).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(
    () => {
      const el = document.querySelector('select, [role="combobox"]');
      return el instanceof HTMLSelectElement && el.value !== '';
    },
    { timeout: 30_000 },
  );
}
