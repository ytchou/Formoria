import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

import { BUDGET } from '../budgets';
/**
 * Newsletter subscribe flow — anonymous visitor journey
 *
 * The newsletter section lives on the homepage (zh-TW default locale).
 * A visitor selects interest chips, enters an email, and submits.
 * On success the form is replaced by a green confirmation banner.
 *
 * Cleanup: afterAll deletes the [E2E-TEST] subscriber row via service-role client.
 */

const TEST_EMAIL_PREFIX = 'e2e-test-newsletter';

test.describe('Newsletter subscribe flow', () => {
  let testEmail: string;

  test.beforeAll(() => {
    // Unique email per test run — avoids collisions when the suite re-runs.
    // Use a reserved domain: staging E2E must not deliver mail externally.
    testEmail = `${TEST_EMAIL_PREFIX}-${Date.now()}@example.test`;
  });

  test.afterAll(async () => {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const { error } = await supabase
      .from('newsletter_subscribers')
      .delete()
      .like('email', `${TEST_EMAIL_PREFIX}%`);
    if (error) throw new Error(`[e2e-cleanup] newsletter cleanup failed: ${error.message}`);
  });

  test('anonymous visitor can subscribe from the homepage', async ({ page }) => {
    test.setTimeout(BUDGET.TEST.JOURNEY);
    await page.goto('/');

    // --- Newsletter section heading ---
    const heading = page.getByRole('heading', { name: '掌握最新動態' });
    await heading.scrollIntoViewIfNeeded();
    await expect(heading).toBeVisible({ timeout: BUDGET.SERVER_RENDER });

    // --- "Curated Picks" chip is pre-selected (aria-pressed="true") ---
    // zh-TW label: "Formoria 選物" (the stored slug stays `curated-picks`)
    const curatedPicksChip = page.getByRole('button', { name: /Formoria 選物/ });
    await expect(curatedPicksChip).toBeVisible({ timeout: BUDGET.RENDERED });
    await expect(curatedPicksChip).toHaveAttribute('aria-pressed', 'true');

    // --- Toggle "Brand Stories" chip on ---
    // zh-TW label: "品牌故事 Brand Stories"
    const brandStoriesChip = page.getByRole('button', { name: /品牌故事/ });
    await expect(brandStoriesChip).toBeVisible({ timeout: BUDGET.RENDERED });
    await expect(brandStoriesChip).toHaveAttribute('aria-pressed', 'false');
    await brandStoriesChip.click();
    await expect(brandStoriesChip).toHaveAttribute('aria-pressed', 'true');

    // --- Enter a unique test email ---
    const emailInput = page.locator('input[name="email"][type="email"]');
    await expect(emailInput).toBeVisible({ timeout: BUDGET.RENDERED });
    await emailInput.fill(testEmail);

    // --- Submit ---
    const subscribeButton = page.getByRole('button', { name: /訂閱/ });
    await subscribeButton.click();

    // --- Success banner replaces the form ---
    // The success div has a green background and contains the confirmation text.
    // zh-TW: "確認信已寄出，請到收件匣點開連結完成訂閱"
    const successBanner = page.getByText('確認信已寄出，請到收件匣點開連結完成訂閱');
    await expect(successBanner).toBeVisible({ timeout: BUDGET.GATED_UI });

    // The form itself must no longer be present
    await expect(emailInput).not.toBeVisible();
  });
});
