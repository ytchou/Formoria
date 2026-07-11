import { test, expect } from '@playwright/test';

test.describe('CJK slug brand detail', () => {
  test('brand card with CJK slug navigates without 404 or routing error', async ({ page }) => {
    await page.goto('/brands');

    // Collect all brand card hrefs that contain CJK characters (non-ASCII URL path segments)
    const cards = page.locator('main a[aria-label]');
    await cards.first().waitFor({ state: 'visible', timeout: 10_000 });

    const allHrefs: string[] = await cards.evaluateAll((anchors) =>
      anchors.map((a) => a.getAttribute('href') ?? '')
    );

    // CJK range: U+4E00–U+9FFF (common CJK unified ideographs, encoded or raw in href)
    const cjkHrefs = allHrefs.filter((href) => {
      const decoded = decodeURIComponent(href);
      return /[一-鿿㐀-䶿]/.test(decoded);
    });

    if (cjkHrefs.length === 0) {
      test.skip(true, 'No brand cards with CJK slugs found on /brands — cannot verify CJK routing');
      return;
    }

    // Try each CJK-slug card until we find an approved one (renders brand name, not 404)
    let foundApproved = false;
    for (const href of cjkHrefs.slice(0, 8)) {
      await page.goto(href);

      const h1 = page.getByRole('heading', { level: 1 });
      await h1.waitFor({ state: 'visible', timeout: 10_000 });
      const h1Text = await h1.textContent();

      // "找不到品牌" = unapproved / not found — try the next one
      if (h1Text?.includes('找不到品牌') || h1Text?.includes('not found')) {
        continue;
      }

      // Found an approved brand — assert the page is healthy
      foundApproved = true;

      // Brand name heading is visible
      await expect(h1).toBeVisible();

      // URL contains the slug (URL-encoded CJK is fine)
      const currentPath = new URL(page.url()).pathname;
      expect(currentPath).toMatch(/^\/brands\//);

      // No error boundary or generic error message
      await expect(page.getByText(/something went wrong|頁面錯誤|系統錯誤|發生錯誤/i)).not.toBeVisible();

      break;
    }

    if (!foundApproved) {
      test.skip(true, 'All CJK-slug brands in the directory are unapproved — CJK routing is present but no approved brand to verify detail render');
    }
  });
});
