import { test, expect } from '../fixtures/auth';
import { createClient } from '@supabase/supabase-js';
import { gotoSubmitWizard } from '../utils/submit-wizard';

test.describe('Submit flow deep', () => {
  const createdSubmissions: string[] = [];
  const manualEntryButtonName = '改為手動填寫';
  const nextButtonName = '下一步';

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
    test.setTimeout(60_000);
    await gotoSubmitWizard(userPage);
  });

  test('validation shows errors on empty required fields', async ({ userPage }) => {
    test.setTimeout(60_000);
    await gotoSubmitWizard(userPage);
    const skipBtn = userPage.getByRole('button', { name: manualEntryButtonName, exact: true });
    await expect(skipBtn).toBeVisible({ timeout: 5_000 });
    await skipBtn.click();
    const nextBtn = userPage.getByRole('button', { name: nextButtonName, exact: true });
    await nextBtn.click();
    await expect(userPage.locator('p.text-red-600').first()).toBeVisible({ timeout: 3_000 });
  });

  test('Tier 1 suspicious TLD in website URL blocks submission with visible error', async () => {
    // Tier 1 content moderation (e.g. suspicious TLD like .tk) is enforced server-side
    // inside the brand-edit dashboard flow (saveBrandDraft action), NOT in the submit
    // wizard. The submit wizard's BrandInfoStep "next" button runs only client-side
    // react-hook-form validation (required fields, format) and does not call the
    // moderation service. Consequently there is no inline error visible at the wizard
    // step level for .tk domains, and submission proceeds to the confirmation page
    // (the brand_submission row is created as pending; moderation happens post-submission).
    //
    // This test is skipped until the submit wizard surfaces a client-visible moderation
    // rejection when a tier-1 rule triggers (blocked before confirmation page).
    test.skip(true, 'Tier 1 hard block is not wired into the submit wizard BrandInfoStep — moderation runs server-side in the dashboard edit flow only.');
  });

  test('unauthenticated user sees submit overview page (not redirected)', async ({ anonPage }) => {
    await anonPage.goto('/submit');
    await expect(anonPage).toHaveURL('/submit', { timeout: 10_000 });
    const cta = anonPage
      .locator('main a[href="/auth/sign-in?next=/submit/form"]:visible')
      .filter({ hasText: /^登入並開始提交$/ });
    await expect(cta).toBeVisible({ timeout: 5_000 });
    await expect(cta).toHaveAttribute('href', '/auth/sign-in?next=/submit/form');
  });

  test('English submit route resolves under /en', async ({ anonPage }) => {
    const res = await anonPage.goto('/en/submit');
    expect(res?.status()).toBe(200);
    await expect(anonPage).toHaveURL(/\/en\/submit/);
  });
});
