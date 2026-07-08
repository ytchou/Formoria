import { test, expect } from '../fixtures/auth';
import { gotoSubmitOwner } from '../utils/submit-form';

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

  test('owner form shows city select and brand links', async ({ userPage }) => {
    test.setTimeout(60_000);
    await gotoSubmitOwner(userPage);

    const citySelect = userPage.locator('#submit-city');
    await expect(citySelect).toBeVisible({ timeout: 5_000 });
    await expect(citySelect.locator('option[value=""]')).toHaveCount(1);
    const taipeiOption = citySelect.locator('option[value="taipei"]');
    await expect(taipeiOption).toHaveCount(1);
    await expect(taipeiOption).toHaveText('臺北市');
    await expect(userPage.locator('#submit-instagram')).toBeVisible();
  });
});
