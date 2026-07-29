import { test, expect } from '@playwright/test';

/**
 * Share dialog journey (DEV-849, redesigned in DEV-1242)
 *
 * Actor: anonymous visitor
 * Goal: Open the share dialog on a brand detail page and share the link
 *
 * Steps:
 *   1. Navigate to /brands and find the first brand card link
 *   2. Click through to the brand detail page
 *   3. Click the "分享" button — the share dialog opens
 *   4. Verify the dialog shows the readable URL field, the preview card, and the
 *      four channel discs (LINE / Threads / Facebook / Instagram)
 *   5. Click "複製" — the button swaps to "已複製！" and reverts after ~2s
 *   6. Instagram (no web share intent) copies first and opens nothing if the
 *      clipboard write is refused
 *   7. Close the dialog via the "關閉" button
 */
test.describe('Brand share dialog', () => {
  let brandHref: string;

  test.beforeAll(async ({ browser }) => {
    // Resolve a brand href from the directory — mirrors brand-detail.spec.ts pattern
    const page = await browser.newPage();
    await page.goto('/brands');
    const brandLinks = page.locator('main a[href^="/brands/"]');
    await brandLinks.first().waitFor({ state: 'visible', timeout: 10_000 });
    const href = await brandLinks.first().getAttribute('href');
    await page.close();

    if (!href) {
      throw new Error(
        'brand-share: could not resolve a brand href from /brands. Ensure the DB has at least one approved brand.'
      );
    }
    brandHref = href;
  });

  test('dialog shows the url field and four channels', async ({ page }) => {
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

    // Dialog must appear with its title.
    //
    // The body is a next/dynamic chunk behind a loading skeleton. The skeleton
    // renders a real role="dialog" (so the overlay and focus trap exist), but its
    // accessible name is the loading label — so this name-scoped locator only
    // matches once the chunk has landed. On CI hardware that fetch has overrun a
    // 5s budget, which is a slow open, not a broken dialog. Every dialog
    // assertion in this file carries the wider budget for the same reason.
    const dialog = page.getByRole('dialog', { name: '分享' });
    await expect(dialog).toBeVisible({ timeout: 15_000 });

    // The preview card repeats the brand name the recipient will see
    await expect(dialog.getByText(brandName, { exact: false }).first()).toBeVisible();

    // The link is readable before anything is pressed — assert the field VALUE,
    // not its text: it is a read-only <input>.
    const urlField = dialog.getByRole('textbox', { name: '品牌頁網址' });
    await expect(urlField).toBeVisible();
    await expect(urlField).toHaveValue(new RegExp(`${brandHref}$`));

    // Copy affordance now lives inside the URL field
    await expect(dialog.getByRole('button', { name: '複製' })).toBeVisible();

    // Exactly four channels, in one row
    for (const channel of ['LINE', 'Threads', 'Facebook', 'Instagram']) {
      await expect(dialog.getByRole('button', { name: channel })).toBeVisible();
    }

    // X was dropped as a channel in DEV-1242
    await expect(dialog.getByRole('button', { name: /^X$/ })).toHaveCount(0);
  });

  test('copy shows 已複製！ feedback then reverts', async ({ page }) => {
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
    await expect(dialog).toBeVisible({ timeout: 15_000 });

    await dialog.getByRole('button', { name: '複製' }).click();

    // Label swaps to "已複製！" (transient React state — wait for it)
    await expect(dialog.getByRole('button', { name: '已複製！' })).toBeVisible({
      timeout: 3_000,
    });

    // After ~2s the label reverts to "複製"
    await expect(dialog.getByRole('button', { name: '複製' })).toBeVisible({
      timeout: 5_000,
    });
  });

  test('instagram copies without opening when the clipboard is denied', async ({ page }) => {
    // Instagram is the only channel with no web share intent: the handler must
    // copy first and open the app only once that copy actually succeeded. If the
    // clipboard write is refused, nothing may open.
    await page.context().clearPermissions();
    await page.addInitScript(() => {
      // clearPermissions alone is not decisive in Chromium (a focused page can
      // still be auto-granted clipboard-write), so refuse the write outright.
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: () => Promise.reject(new DOMException('denied', 'NotAllowedError')),
        },
      });
    });

    const resp = await page.goto(brandHref);
    if (resp?.status() === 503) {
      test.skip(true, 'PREVIEW_MODE active — skipping.');
      return;
    }

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 });

    let popupOpened = false;
    page.on('popup', () => {
      popupOpened = true;
    });

    await page.getByRole('button', { name: '分享' }).click();

    const dialog = page.getByRole('dialog', { name: '分享' });
    await expect(dialog).toBeVisible({ timeout: 15_000 });

    await dialog.getByRole('button', { name: 'Instagram' }).click();

    // Give any (wrongly) opened popup time to surface before asserting absence.
    await page.waitForTimeout(2_000);

    expect(popupOpened).toBe(false);
    // …and no success announcement either — the copy never happened.
    // (matched on the tail of the string so this file stays free of the old
    // "copy link" label the redesign deleted)
    await expect(dialog.getByText('貼到限時動態或個人簡介')).toHaveCount(0);
    // The dialog stays open so the visitor can copy the URL manually.
    await expect(dialog).toBeVisible();
  });

  test('dialog closes', async ({ page }) => {
    const resp = await page.goto(brandHref);
    if (resp?.status() === 503) {
      test.skip(true, 'PREVIEW_MODE active — skipping.');
      return;
    }

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: '分享' }).click();

    const dialog = page.getByRole('dialog', { name: '分享' });
    await expect(dialog).toBeVisible({ timeout: 15_000 });

    await dialog.getByRole('button', { name: '關閉' }).click();

    await expect(dialog).not.toBeVisible({ timeout: 3_000 });
  });
});
