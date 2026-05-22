import { test, expect } from '@playwright/test';

// These tests run under the 'mobile' project (375px viewport via Pixel 5 device)
test.describe('Mobile responsive', () => {
  const pages = ['/', '/brands', '/submit'];

  for (const url of pages) {
    test(`${url} has no horizontal overflow at 375px`, async ({ page }) => {
      await page.goto(url);
      await page.waitForLoadState('networkidle');
      const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
      const viewportWidth = page.viewportSize()?.width ?? 375;
      expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 5); // 5px tolerance
    });
  }

  test('homepage renders brand cards in single column', async ({ page }) => {
    await page.goto('/');
    const firstCard = page.locator('[data-testid="brand-card"]').first();
    await expect(firstCard).toBeVisible({ timeout: 10_000 });
    const box = await firstCard.boundingBox();
    // Card should be close to full viewport width on mobile
    expect(box?.width).toBeGreaterThan(300);
  });

  test('navigation is accessible (hamburger or nav visible)', async ({ page }) => {
    await page.goto('/');
    const nav = page.locator('nav, [role="navigation"]');
    const hamburger = page.locator('[aria-label*="menu"], [data-testid="hamburger"]');
    await expect(nav.or(hamburger).first()).toBeVisible({ timeout: 5_000 });
  });

  test('sign-in page has no horizontal overflow at 375px', async ({ page }) => {
    // Tests auth page mobile layout — /admin redirects here for unauthenticated users
    await page.goto('/auth/sign-in');
    await page.waitForLoadState('networkidle');
    const body = await page.evaluate(() => document.body.scrollWidth);
    expect(body).toBeLessThanOrEqual(page.viewportSize()!.width + 5);
  });
});
