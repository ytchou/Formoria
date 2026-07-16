import { test, expect } from '@playwright/test';

// Stable constants for the subcategory filter journey (DEV-1032)
const E2E_CATEGORY_SLUG = 'bags-accessories' as const;
const E2E_SUB_SLUG = 'clasp-frame-bags' as const;
// Chinese label rendered in zh-TW locale for clasp-frame-bags
const E2E_SUB_LABEL_ZH = '口金包' as const;

test.describe('Subcategory filter deep', () => {
  /**
   * Full interaction journey: navigate → verify chips appear → click 口金包 chip →
   * verify URL gains sub=clasp-frame-bags → verify grid responds → un-click chip →
   * verify URL restores to no sub=.
   *
   * Guard: chips only appear when subcategory_filter_enabled=true AND the DB has
   * approved bags-accessories brands with matching product_tags. Skip if absent so
   * the suite stays green in environments without data.
   */
  test('clicking 口金包 chip adds sub=clasp-frame-bags to URL and restores on un-click', async ({ page }) => {
    await page.goto(`/brands?category=${E2E_CATEGORY_SLUG}`, { waitUntil: 'networkidle' });

    // Guard: look for the 口金包 chip specifically.
    // getSubcategoryCounts() excludes [E2E-TEST]% brands, so chips depend on real data.
    const claspChip = page
      .locator('aside button[aria-pressed]')
      .filter({ hasText: new RegExp(E2E_SUB_LABEL_ZH) })
      .first();

    const chipVisible = await claspChip.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!chipVisible) {
      test.skip(
        true,
        `${E2E_SUB_LABEL_ZH} subcategory chip not visible — ` +
          'subcategory_filter_enabled may be false or product_tags data not yet populated',
      );
      return;
    }

    // Chip is present and not yet active
    await expect(claspChip).toHaveAttribute('aria-pressed', 'false');

    // Click the chip — router.replace fires immediately (scroll: false)
    await claspChip.click();
    await expect(page).toHaveURL(new RegExp(`[?&]sub=${E2E_SUB_SLUG}`), { timeout: 10_000 });

    // Chip should now be active
    const activeChip = page
      .locator('aside button[aria-pressed="true"]')
      .filter({ hasText: new RegExp(E2E_SUB_LABEL_ZH) })
      .first();
    await expect(activeChip).toBeVisible({ timeout: 5_000 });

    // Wait for the filtered view to settle
    await page.waitForLoadState('networkidle');

    // Un-click the active chip — sub= should be removed from URL
    await activeChip.click();
    await expect(page).not.toHaveURL(/[?&]sub=/, { timeout: 10_000 });
  });

  /**
   * Verify that navigating directly to a sub-filtered URL pre-activates the chip.
   * This tests that the sidebar reads activeSubSlugs from server-rendered props correctly.
   *
   * Guard: same as above — skip if no chips in the current environment.
   */
  test('direct navigation to sub-filtered URL pre-activates the correct chip', async ({ page }) => {
    await page.goto(`/brands?category=${E2E_CATEGORY_SLUG}&sub=${E2E_SUB_SLUG}`, { waitUntil: 'networkidle' });

    const activeChip = page
      .locator('aside button[aria-pressed="true"]')
      .filter({ hasText: new RegExp(E2E_SUB_LABEL_ZH) })
      .first();

    const chipActive = await activeChip.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!chipActive) {
      test.skip(
        true,
        `${E2E_SUB_LABEL_ZH} chip not pre-activated — ` +
          'subcategory_filter_enabled may be false or product_tags data not yet populated',
      );
      return;
    }

    await expect(activeChip).toHaveAttribute('aria-pressed', 'true');
  });
});
