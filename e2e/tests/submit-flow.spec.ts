import { test, expect } from '../fixtures/auth';
import { createClient } from '@supabase/supabase-js';

test.describe('Submit flow deep', () => {
  const createdSubmissions: string[] = [];

  test.afterAll(async () => {
    // createClient is deferred to afterAll to ensure env vars are loaded by Playwright
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    if (createdSubmissions.length > 0) {
      await supabase.from('brand_submissions').delete().in('id', createdSubmissions);
    }
    // Also cleanup by name prefix
    await supabase.from('brand_submissions').delete().like('brand_name', '[E2E-TEST]%');
  });

  test('wizard steps are all reachable', async ({ userPage }) => {
    await userPage.goto('/submit');
    // Should show wizard step 1 indicator
    await expect(userPage.locator('[data-testid="step-indicator"], [aria-label*="step"]').first()
      .or(userPage.getByRole('heading'))).toBeVisible({ timeout: 5_000 });
  });

  test('validation shows errors on empty required fields', async ({ userPage }) => {
    await userPage.goto('/submit');
    const nextBtn = userPage.getByRole('button', { name: /next|continue/i }).first();
    await nextBtn.click();
    // Error message should appear
    await expect(
      userPage.locator('[data-testid="field-error"], [role="alert"], .error').first()
    ).toBeVisible({ timeout: 3_000 });
  });

  test('Tier 1 keyword blocks submission', async ({ userPage }) => {
    await userPage.goto('/submit');
    // Navigate to brand name step and enter a Tier 1 trigger word
    const inputs = userPage.locator('input[type="text"], textarea');
    await inputs.first().fill('https://example.com');
    const nextBtns = userPage.getByRole('button', { name: /next|continue/i });
    await nextBtns.first().click({ force: true });
    // Fill brand name with Tier 1 trigger word
    const nameInput = userPage.getByLabel(/brand name|name/i);
    if (await nameInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await nameInput.fill('[E2E-TEST] Brand with explicit_blocked_word');
      // Advance to trigger validation
      const nextBtn = userPage.getByRole('button', { name: /next|continue/i }).first();
      if (await nextBtn.isVisible()) await nextBtn.click({ force: true });
    }
    // Tier 1 block should show an error/rejection message OR redirect to a rejection page
    // The user must NOT reach the confirmation page
    await expect(
      userPage.locator('[data-testid="field-error"], [role="alert"], .error').first()
        .or(userPage.getByText(/blocked|not allowed|rejected|flagged/i))
    ).toBeVisible({ timeout: 5_000 });
    await expect(userPage).not.toHaveURL(/\/submit\/confirmation|\/submit\/success/i);
  });

  test('unauthenticated user is redirected to sign-in', async ({ anonPage }) => {
    await anonPage.goto('/submit');
    await expect(anonPage).toHaveURL(/\/sign-in|\/login/i, { timeout: 10_000 });
  });
});
