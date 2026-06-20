import { test, expect } from '@playwright/test';

/**
 * Share dialog journey (DEV-849)
 *
 * Actor: anonymous visitor
 * Goal: Open the share dialog on a brand detail page and use the Copy Link option
 *
 * Steps:
 *   1. Navigate to /brands and find the first brand card link
 *   2. Click through to the brand detail page
 *   3. Click the "分享" button — the share dialog opens
 *   4. Verify dialog has title, brand name, and 4 share option buttons
 *   5. Click "複製連結" — button text changes to "已複製！"
 *   6. Close the dialog
 */
test.describe('Brand share dialog', () => {
  let brandHref: string;

  test.beforeAll(async ({ browser }) => {
    // Resolve a brand href from the directory — mirrors brand-detail.spec.ts pattern
    const page = await browser.newPage();
    await page.goto('/brands');
    const firstCard = page.locator('main a[aria-label]').first();
    await firstCard.waitFor({ state: 'visible', timeout: 10_000 }).catch(async () => {
      // Fallback: any list link in main pointing to /brands/
      await page
        .locator('main a[href^="/brands/"]')
        .first()
        .waitFor({ state: 'visible', timeout: 10_000 });
    });

    const href =
      (await page.locator('main a[aria-label]').first().getAttribute('href').catch(() => null)) ??
      (await page.locator('main a[href^="/brands/"]').first().getAttribute('href').catch(() => null));
    await page.close();

    if (!href) {
      throw new Error(
        'brand-share: could not resolve a brand href from /brands. Ensure the DB has at least one approved brand.'
      );
    }
    brandHref = href;
  });

  test('share dialog opens with brand name and 4 options', async ({ page }) => {
    const resp = await page.goto(brandHref);
    if (resp?.status() === 503) {
      test.skip(true, 'PREVIEW_MODE active — skipping.');
      return;
    }

    // Wait for the page heading to confirm the brand detail loaded
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 });

    // Grab the brand name from the h1 for later assertion in the dialog
    const brandName = await page.getByRole('heading', { level: 1 }).innerText();

    // Click the share trigger button
    await page.getByRole('button', { name: '分享' }).click();

    // Dialog must appear with its title
    const dialog = page.getByRole('dialog', { name: '分享' });
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Dialog shows the brand name
    await expect(dialog.getByText(brandName, { exact: false })).toBeVisible();

    // All 4 share option buttons must be rendered
    await expect(dialog.getByRole('button', { name: '複製連結' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'LINE' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Facebook' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'X' })).toBeVisible();
  });

  test('Copy Link shows 已複製！ feedback then reverts', async ({ page }) => {
    const resp = await page.goto(brandHref);
    if (resp?.status() === 503) {
      test.skip(true, 'PREVIEW_MODE active — skipping.');
      return;
    }

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 });

    // Grant clipboard permission so navigator.clipboard.writeText succeeds
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

    await page.getByRole('button', { name: '分享' }).click();

    const dialog = page.getByRole('dialog', { name: '分享' });
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Click Copy Link
    await dialog.getByRole('button', { name: '複製連結' }).click();

    // Button text changes to "已複製！" (transient React state — wait for it)
    await expect(dialog.getByRole('button', { name: '已複製！' })).toBeVisible({
      timeout: 3_000,
    });

    // After ~2s the label reverts to "複製連結"
    await expect(dialog.getByRole('button', { name: '複製連結' })).toBeVisible({
      timeout: 5_000,
    });
  });

  test('dialog closes when close button is clicked', async ({ page }) => {
    const resp = await page.goto(brandHref);
    if (resp?.status() === 503) {
      test.skip(true, 'PREVIEW_MODE active — skipping.');
      return;
    }

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: '分享' }).click();

    const dialog = page.getByRole('dialog', { name: '分享' });
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Close via the Close button (screen-reader text: "Close")
    await dialog.getByRole('button', { name: 'Close' }).click();

    await expect(dialog).not.toBeVisible({ timeout: 3_000 });
  });
});
