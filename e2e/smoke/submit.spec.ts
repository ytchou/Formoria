import { test, expect } from '../fixtures/auth';
import { createClient } from '@supabase/supabase-js';

const TEST_PREFIX = '[E2E-TEST]' as const;

test.describe('Submit smoke', () => {
  let submittedBrandName: string;

  test.afterAll(async () => {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    await supabase.from('brand_submissions').delete().like('brand_name', `${TEST_PREFIX}%`);
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
        // Wait for the button to re-enable or the URL to change (next step loaded)
        await userPage.waitForLoadState('domcontentloaded');
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
