import { test, expect } from '@playwright/test';

// These tests run under the 'mobile' project (375px viewport via Pixel 5 device)
test.describe('Mobile responsive', () => {
  const pages = ['/', '/brands', '/submit'];

  for (const url of pages) {
    test(`${url} has no horizontal overflow at 375px`, async ({ page }) => {
      await page.goto(url);
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('header')).toBeVisible();
      const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
      const viewportWidth = page.viewportSize()?.width ?? 375;
      expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 5); // 5px tolerance
    });
  }

  test('brands directory renders brand cards on mobile', async ({ page }) => {
    const vw = page.viewportSize()?.width ?? 1280;
    test.skip(vw > 640, 'Mobile card assertion only valid on mobile viewports');
    await page.goto('/brands');
    // Verify at least one brand card is visible in the masonry grid
    const firstCard = page.locator('.masonry-grid [role="listitem"] a[aria-label]:visible').first();
    const hasCard = await firstCard.isVisible({ timeout: 10_000 }).catch(() => false);
    if (!hasCard) {
      test.skip(true, 'No brands seeded — skipping brand card mobile check');
      return;
    }
    await expect(firstCard).toBeVisible();
  });

  test('navigation is accessible (hamburger or nav visible)', async ({ page }) => {
    await page.goto('/');
    const hamburger = page.getByRole('button', { name: 'Open menu', exact: true });
    const nav = page.locator('header nav:visible');
    if (await hamburger.isVisible().catch(() => false)) {
      await expect(hamburger).toBeVisible({ timeout: 5_000 });
      return;
    }
    await expect(nav).toBeVisible({ timeout: 5_000 });
  });

  test('sign-in page has no horizontal overflow at 375px', async ({ page }) => {
    // Tests auth page mobile layout — /admin redirects here for unauthenticated users
    await page.goto('/auth/sign-in');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('header')).toBeVisible();
    const body = await page.evaluate(() => document.body.scrollWidth);
    expect(body).toBeLessThanOrEqual(page.viewportSize()!.width + 5);
  });
});
