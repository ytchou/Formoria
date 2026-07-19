import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { test, expect } from '../fixtures/auth';

test.describe('Admin newsletter operations deep', () => {
  test.beforeEach(() => {
    const adminEmail = process.env.E2E_ADMIN_EMAIL;
    const admins = (process.env.ADMIN_EMAILS ?? '').split(',').map((email) => email.trim());
    test.skip(!adminEmail || !admins.includes(adminEmail), 'Admin credentials are required');
  });

  const subscriberId = randomUUID();
  const subscriberEmail = `e2e-newsletter-${subscriberId}@example.com`;
  let supabase: ReturnType<typeof createClient>;

  test.beforeAll(async () => {
    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    const { error } = await supabase.from('newsletter_subscribers').insert({
      id: subscriberId,
      email: subscriberEmail,
      name: 'E2E Newsletter Reader',
      interests: ['brand-stories'],
      locale: 'en',
      consent_source: 'homepage_newsletter',
      consent_version: '2026-07-16',
      consent_recorded_at: new Date().toISOString(),
    });
    if (error) throw new Error(`newsletter seed failed: ${error.message}`);
  });

  test.afterAll(async () => {
    await supabase.from('newsletter_subscribers').delete().eq('id', subscriberId);
  });

  test('admin filters pending subscribers without exposing action tokens', async ({ adminPage }) => {
    await adminPage.goto(`/admin/newsletter?status=pending&q=${encodeURIComponent(subscriberEmail)}`, { timeout: 60_000 });
    await expect(adminPage.getByRole('heading', { name: 'Newsletter' })).toBeVisible({ timeout: 60_000 });
    const row = adminPage.locator('tbody tr').filter({ hasText: subscriberEmail });
    await expect(row).toBeVisible();
    await expect(row).toContainText('Pending');
    await expect(row.getByRole('button', { name: 'Resend confirmation' })).toBeVisible();
    await expect(adminPage.getByText(/confirm_token|unsubscribe_token/i)).toHaveCount(0);
    await expect(adminPage.getByRole('link', { name: 'Export CSV' })).toHaveAttribute(
      'href',
      new RegExp('status=pending'),
    );
  });
});
