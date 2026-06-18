import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

/**
 * Newsletter subscribe flow — anonymous visitor journey
 *
 * The newsletter section lives on the homepage (zh-TW default locale).
 * A visitor selects interest chips, enters an email, and submits.
 * On success the form is replaced by a green confirmation banner.
 *
 * Cleanup: afterAll deletes the [E2E-TEST] subscriber row via service-role client.
 */

const TEST_EMAIL_PREFIX = '[e2e-test]-newsletter';

test.describe('Newsletter subscribe flow', () => {
  let testEmail: string;

  test.beforeAll(() => {
    // Unique email per test run — avoids collisions when the suite re-runs
    testEmail = `${TEST_EMAIL_PREFIX}-${Date.now()}@example.com`;
  });

  test.afterAll(async () => {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    await supabase
      .from('newsletter_subscribers')
      .delete()
      .like('email', `${TEST_EMAIL_PREFIX}%`);
  });

  test('anonymous visitor can subscribe from the homepage', async ({ page }) => {
    test.setTimeout(60_000);

    await page.goto('/zh-TW');

    // --- Newsletter section heading ---
    const heading = page.getByRole('heading', { name: '掌握最新動態' });
    await heading.scrollIntoViewIfNeeded();
    await expect(heading).toBeVisible({ timeout: 15_000 });

    // --- "New Brands" chip is pre-selected (aria-pressed="true") ---
    // zh-TW label: "新品牌 New Brands"
    const newBrandsChip = page.getByRole('button', { name: /新品牌/ });
    await expect(newBrandsChip).toBeVisible({ timeout: 5_000 });
    await expect(newBrandsChip).toHaveAttribute('aria-pressed', 'true');

    // --- Toggle "Brand Stories" chip on ---
    // zh-TW label: "品牌故事 Brand Stories"
    const brandStoriesChip = page.getByRole('button', { name: /品牌故事/ });
    await expect(brandStoriesChip).toBeVisible({ timeout: 5_000 });
    await expect(brandStoriesChip).toHaveAttribute('aria-pressed', 'false');
    await brandStoriesChip.click();
    await expect(brandStoriesChip).toHaveAttribute('aria-pressed', 'true');

    // --- Enter a unique test email ---
    const emailInput = page.locator('input[name="email"][type="email"]');
    await expect(emailInput).toBeVisible({ timeout: 5_000 });
    await emailInput.fill(testEmail);

    // --- Submit ---
    const subscribeButton = page.getByRole('button', { name: /訂閱/ });
    await subscribeButton.click();

    // --- Success banner replaces the form ---
    // The success div has a green background and contains the confirmation text.
    // zh-TW: "請查看您的收件匣以確認訂閱 / Check your inbox to confirm your subscription"
    const successBanner = page.locator('div').filter({
      hasText: /請查看您的收件匣以確認訂閱/,
    });
    await expect(successBanner).toBeVisible({ timeout: 20_000 });

    // The form itself must no longer be present
    await expect(emailInput).not.toBeVisible();
  });
});
