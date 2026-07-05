import { test, expect } from '../fixtures/auth';
import { gotoSubmitForm } from '../utils/submit-form';

test.describe('Submit smoke', () => {
  test('submit form loads at /submit/form with all required fields visible', async ({ userPage }) => {
    await userPage.goto('/submit/form');

    // Page-level heading on the flat single-screen form
    await expect(
      userPage.getByRole('heading', { name: '提交台灣品牌', exact: true })
    ).toBeVisible({ timeout: 15_000 });

    // Website URL field is visible immediately (no URL discovery phase)
    await expect(userPage.locator('#submit-website')).toBeVisible();

    // Brand name field is visible immediately (no wizard step)
    await expect(userPage.locator('#submit-name')).toBeVisible();

    // Owner checkbox is visible immediately on the flat form
    await expect(userPage.locator('#submit-is-owner')).toBeVisible();

    // No step indicator — this is a single screen, not a wizard
    await expect(userPage.locator('[data-state="active"]')).not.toBeVisible();
  });

  test('city select is present with placeholder and at least one city option', async ({ userPage }) => {
    test.setTimeout(60_000);
    await gotoSubmitForm(userPage);

    // City select must be visible (optional field on the flat form)
    const citySelect = userPage.locator('#submit-city');
    await expect(citySelect).toBeVisible({ timeout: 5_000 });

    // Placeholder option (value="") is always first
    await expect(citySelect.locator('option[value=""]')).toHaveCount(1);

    // Taipei city option is present and correctly labelled in Traditional Chinese
    const taipeiOption = citySelect.locator('option[value="taipei"]');
    await expect(taipeiOption).toHaveCount(1);
    await expect(taipeiOption).toHaveText('臺北市');
  });
});
