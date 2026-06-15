import { test, expect } from '../fixtures/auth';
import { gotoSubmitWizard } from '../utils/submit-wizard';

const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVR4nGP4z8AARwgWXg4ArpMP8aaUSCMAAAAASUVORK5CYII=';
const manualEntryButtonName = '跳過，手動填寫';
const nextButtonName = '下一步';

test.describe('UrlStep link pre-fill', () => {
  test(
    'social + purchase links entered in UrlStep appear in the review step',
    async ({ userPage }) => {
      test.setTimeout(120_000);

      // PREVIEW_MODE guard — probe before spending time on the wizard
      const probe = await userPage.goto('/submit/form');
      if (probe?.status() === 503) {
        test.skip(true, 'PREVIEW_MODE active — submit route returns 503');
        return;
      }

      // Re-navigate through the shared helper so the hydration signal is respected.
      await gotoSubmitWizard(userPage, { timeout: 90_000 });

      // --- UrlStep: fill social + purchase fields before skipping ---
      await userPage.locator('#url-instagram').fill('@e2e_url_links');
      await userPage.locator('#url-threads').fill('@e2e_threads');
      await userPage.locator('#url-facebook').fill('https://facebook.com/e2e-url-links');

      // Purchase link: native <select role="combobox"> then the url input in the same section.
      // index 0 is the website-url input; index 1 is the first purchase-link url input.
      await userPage.locator('select[role="combobox"]').first().selectOption('pinkoi');
      await userPage.locator('input[type="url"]').nth(1).fill('https://pinkoi.com/e2e-test-store');

      // Skip to the form wizard (hand-fill mode).  handleUrlSkip sets socialLinks +
      // purchaseLinks on the react-hook-form before mounting the step-based wizard.
      await userPage.getByRole('button', { name: manualEntryButtonName, exact: true }).click();

      // --- Step 0: BrandInfoStep (required fields) ---
      await expect(userPage.getByLabel('品牌名稱', { exact: true })).toBeVisible({
        timeout: 5_000,
      });
      const brandName = `[E2E-TEST] UrlLinks ${Date.now()}`;
      await userPage.getByLabel('品牌名稱', { exact: true }).fill(brandName);
      await userPage
        .getByLabel('品牌描述', { exact: true })
        .fill('E2E test brand for UrlStep link pre-fill journey. Verifies PR #132 wiring.');
      await userPage.getByLabel('類別', { exact: true }).selectOption({ index: 1 });
      await userPage.getByText('服飾鞋履', { exact: true }).click();

      const logoUploadInput = userPage.locator('input[type="file"]');
      await Promise.all([
        userPage.waitForResponse(
          (response) => response.url().includes('/api/upload') && response.ok(),
          { timeout: 30_000 }
        ),
        logoUploadInput.setInputFiles({
          name: 'tiny-logo.png',
          mimeType: 'image/png',
          buffer: Buffer.from(TINY_PNG_BASE64, 'base64'),
        }),
      ]);
      await expect(userPage.getByAltText('上傳 1')).toBeVisible({ timeout: 10_000 });
      await userPage.getByRole('button', { name: nextButtonName, exact: true }).click();

      // --- Step 1: TagsStep (product types + value tags; just advance) ---
      await userPage.getByRole('button', { name: nextButtonName, exact: true }).click();

      // --- Step 2: ReviewStep — assert the pre-filled links are rendered ---
      // The panel heading for the links section is "連結與社群" (submit.review.linksAndSocial).
      await expect(userPage.getByText('連結與社群', { exact: true })).toBeVisible({
        timeout: 5_000,
      });

      // Purchase link: ReviewRow renders the platform as label and the URL as an anchor.
      await expect(userPage.getByRole('link', { name: 'https://pinkoi.com/e2e-test-store' })).toBeVisible();

      // Instagram: ReviewRow label="Instagram", value=formData.socialLinks.instagram
      await expect(userPage.getByText('@e2e_url_links')).toBeVisible();

      // Website: ReviewRow label="Website", value=formData.socialLinks.website.
      // The website field in UrlStep is the #website-url input; we left it empty in this test
      // so the Website row is omitted (conditional render).  No assertion needed.
    }
  );

  test(
    'wizard step indicator labels are visible',
    async ({ userPage }) => {
      test.setTimeout(90_000);

      const probe = await userPage.goto('/submit/form');
      if (probe?.status() === 503) {
        test.skip(true, 'PREVIEW_MODE active — submit route returns 503');
        return;
      }

      await gotoSubmitWizard(userPage, { timeout: 90_000 });
      await userPage.getByRole('button', { name: manualEntryButtonName, exact: true }).click();

      // Advance to step 0 being active (BrandInfoStep visible)
      await expect(userPage.getByLabel('品牌名稱', { exact: true })).toBeVisible({
        timeout: 5_000,
      });

      // The step-indicator tab for the second wizard step (index 1) should read "分類與特色"
      // (StepIndicator renders "{index}  {label}" so exact match won't work).
      await expect(userPage.getByText('分類與特色')).toBeVisible();
    }
  );
});
