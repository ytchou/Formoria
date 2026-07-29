import { test, expect } from '../fixtures/auth';
import { gotoSubmitOwner } from '../utils/submit-form';
import { OWNER_FEATURES_OFF_REASON } from '../helpers/owner-features';

test.describe('Submit smoke', () => {
  test('recommendation form loads at /submit/recommend with guest fields visible', async ({ anonPage }) => {
    await anonPage.goto('/submit/recommend');

    await expect(
      anonPage.getByRole('heading', { name: '推薦品牌', exact: true })
    ).toBeVisible({ timeout: 15_000 });

    await expect(anonPage.locator('#submit-website')).toBeVisible();
    await expect(anonPage.locator('#submit-name')).toBeVisible();
    await expect(anonPage.locator('#submit-source')).toBeVisible();
    await expect(anonPage.locator('#submit-guest-email')).toBeVisible();
  });

  test('owner quick form shows name, website, and description fields', async ({ userPage }) => {
    test.setTimeout(60_000);

    // The owner fork 404s while owner features are gated off (DEV-1261). Check
    // the status first: gotoSubmitOwner() polls for the heading with toPass and
    // would burn its whole 90s budget on a page that will never render.
    const probe = await userPage.goto('/submit/owner/quick', { timeout: 60_000 });
    if (probe?.status() === 404) {
      test.skip(true, OWNER_FEATURES_OFF_REASON);
      return;
    }

    await gotoSubmitOwner(userPage);

    await expect(userPage.locator('#submit-name')).toBeVisible({ timeout: 5_000 });
    await expect(userPage.locator('#submit-website')).toBeVisible();
    await expect(userPage.locator('#submit-description')).toBeVisible();
  });
});
