import { test, expect } from '../fixtures/auth';

const TEST_PREFIX = '[E2E-TEST]' as const;

test.describe('Submit smoke', () => {
  let submittedBrandName: string;

  test.afterAll(async () => {
    // Cleanup: delete any [E2E-TEST] submissions created during this run
    // via admin API or direct Supabase REST call if needed
    // This is a best-effort cleanup
  });

  test('authenticated user can complete submission wizard', async ({ userPage }) => {
    submittedBrandName = `${TEST_PREFIX} Smoke Brand ${Date.now()}`;

    await userPage.goto('/submit');
    await expect(userPage.getByRole('heading', { name: /submit|add brand/i })).toBeVisible();

    // Step 1: Brand URL / basic info
    // The wizard may start with URL or name depending on implementation
    // Fill first available text input
    const firstInput = userPage.locator('input[type="url"], input[type="text"]').first();
    await firstInput.fill('https://example.com');
    await userPage.getByRole('button', { name: /next|continue/i }).first().click();

    // Step 2: Brand name
    const nameInput = userPage.getByLabel(/brand name|name/i);
    if (await nameInput.isVisible()) {
      await nameInput.fill(submittedBrandName);
      await userPage.getByRole('button', { name: /next|continue/i }).first().click();
    }

    // Navigate through remaining steps (up to 6 total)
    for (let i = 0; i < 5; i++) {
      const nextBtn = userPage.getByRole('button', { name: /next|continue|skip/i }).first();
      if (await nextBtn.isVisible()) {
        await nextBtn.click();
        await userPage.waitForTimeout(300);
      } else {
        break;
      }
    }

    // Submit button on final step
    const submitBtn = userPage.getByRole('button', { name: /submit|finish/i });
    if (await submitBtn.isVisible()) {
      await submitBtn.click();
    }

    // Should reach confirmation page
    await expect(userPage).toHaveURL(/\/submit\/confirmation|\/submit\/success/i, { timeout: 15_000 });
    await expect(userPage.getByText(/submitted|received|thank/i)).toBeVisible();
  });
});
