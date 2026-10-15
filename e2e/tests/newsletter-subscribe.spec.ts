import { test, expect } from '../fixtures/auth';
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
  const ownedEmails: string[] = [];

  test.beforeAll(() => {
    // Unique email per test run — avoids collisions when the suite re-runs.
    // Use a reserved domain: staging E2E must not deliver mail externally.
    testEmail = `${TEST_EMAIL_PREFIX}-${Date.now()}@example.test`;
    ownedEmails.push(testEmail);
  });

  test.afterAll(async () => {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const { error } = await supabase
      .from('newsletter_subscribers')
      .delete()
      .in('email', ownedEmails);
    if (error) throw new Error(`[e2e-cleanup] newsletter cleanup failed: ${error.message}`);
  });

  test('anonymous visitor can subscribe from the homepage', async ({ anonPage }) => {
    const page = anonPage;
    test.setTimeout(BUDGET.TEST.JOURNEY);
    await page.goto('/');

    // --- Newsletter section heading ---
    const heading = page.getByRole('heading', { name: '訂閱 Formoria 電子報' });
    await heading.scrollIntoViewIfNeeded();
    await expect(heading).toBeVisible({ timeout: BUDGET.SERVER_RENDER });

    // --- "Curated Picks" chip is pre-selected (aria-pressed="true") ---
    // zh-TW label: "Formoria 選物" (the stored slug stays `curated-picks`)
    const curatedPicksChip = page.getByRole('button', { name: /Formoria 選物/ });
    await expect(curatedPicksChip).toBeVisible({ timeout: BUDGET.RENDERED });
    await expect(curatedPicksChip).toHaveAttribute('aria-pressed', 'true');

    // --- Toggle the brand-stories chip on ---
    // zh-TW label: "專題" (the stored slug stays `brand-stories`). Exact, so it
    // cannot match another button whose name merely contains 專題.
    const brandStoriesChip = page.getByRole('button', { name: '專題', exact: true });
    await expect(brandStoriesChip).toBeVisible({ timeout: BUDGET.RENDERED });
    await expect(brandStoriesChip).toHaveAttribute('aria-pressed', 'false');
    await brandStoriesChip.click();
    await expect(brandStoriesChip).toHaveAttribute('aria-pressed', 'true');

    // --- Enter a unique test email ---
    const emailInput = page.locator('input[name="email"][type="email"]');
    await expect(emailInput).toBeVisible({ timeout: BUDGET.RENDERED });
    await expect(emailInput).toHaveAccessibleName('電子郵件');
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

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    const { data: subscriber, error } = await supabase
      .from('newsletter_subscribers')
      .select('email, confirmed_at, interests')
      .eq('email', testEmail)
      .single();
    expect(error).toBeNull();
    expect(subscriber).toMatchObject({
      email: testEmail,
      confirmed_at: null,
      interests: expect.arrayContaining(['curated-picks', 'brand-stories']),
    });
  });

  test('an email-only repeat preserves an active subscriber’s preferences and consent', async ({ anonPage }) => {
    const email = `${TEST_EMAIL_PREFIX}-active-${crypto.randomUUID()}@example.test`;
    ownedEmails.push(email);
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    const original = {
      interests: ['brand-stories'],
      locale: 'zh-TW',
      confirmed_at: new Date().toISOString(),
      consent_source: 'settings',
      consent_version: '2026-07-16',
      consent_recorded_at: new Date().toISOString(),
    };
    const created = await supabase.from('newsletter_subscribers')
      .insert({ email, ...original })
      .select('interests, locale, confirmed_at, consent_source, consent_version, consent_recorded_at')
      .single();
    expect(created.error).toBeNull();

    await anonPage.goto('/en');
    const emailInput = anonPage.locator('input[name="email"][type="email"]');
    await emailInput.fill(email);
    await anonPage.getByRole('button', { name: 'Subscribe', exact: true }).click();
    await expect(anonPage.getByText('Confirmation email sent. Open the link in it to finish subscribing.', { exact: true }))
      .toBeVisible({ timeout: BUDGET.GATED_UI });
    await expect(emailInput).not.toBeVisible({ timeout: BUDGET.GATED_UI });
    const persisted = await supabase.from('newsletter_subscribers')
      .select('interests, locale, confirmed_at, consent_source, consent_version, consent_recorded_at')
      .eq('email', email)
      .single();
    expect(persisted.error).toBeNull();
    expect(persisted.data).toEqual(created.data);
  });
});

test.describe('Newsletter — interrupted request recovery', () => {
  for (const { locale, prefix, message } of [
    { locale: 'zh-TW', prefix: '', message: '訂閱暫時無法完成，請稍後再試。' },
    { locale: 'en', prefix: '/en', message: 'Your subscription didn’t go through. Try again in a moment.' },
  ]) {
    test(`a dropped newsletter request preserves email and interests and permits retry (${locale})`, async ({ page }) => {
      let release = () => {};
      const held = new Promise<void>((resolve) => { release = resolve; });
      let attempts = 0;
      await page.route('**/*', async (route) => {
        if (route.request().method() !== 'POST') return route.continue();
        if (route.request().headers()['next-action']) attempts++;
        await held;
        await route.abort('failed');
      });
      try {
        await page.goto(prefix || '/');
        const form = page.locator('form:has(input[name="email"])');
        const email = form.locator('input[name="email"]');
        const submit = form.locator('button[type="submit"]');
        // FormField's error slot: a polite live region the input's
        // aria-describedby points at (no role="alert").
        const emailError = form.locator('p[aria-live="polite"]');
        const stories = form.getByRole('button', { name: locale === 'en' ? 'Stories' : '專題', exact: true });
        await stories.click();
        await expect(stories).toHaveAttribute('aria-pressed', 'true');
        await email.fill('m.garcia+transport@company.invalid');
        await submit.click();
        await expect(submit).toBeDisabled();
        await expect.poll(() => attempts).toBe(1);
        await email.press('Enter');
        expect(attempts).toBe(1);
        release();
        await expect(emailError).toHaveText(message);
        await expect(submit).toBeEnabled();
        await expect(email).toHaveValue('m.garcia+transport@company.invalid');
        await expect(stories).toHaveAttribute('aria-pressed', 'true');
        await submit.click();
        await expect.poll(() => attempts).toBe(2);
        await expect(submit).toBeEnabled();
        await expect(emailError).toHaveText(message);
        await expect(email).toHaveValue('m.garcia+transport@company.invalid');
        await expect(stories).toHaveAttribute('aria-pressed', 'true');
      } finally {
        release();
      }
    });
  }
});
