import { test, expect } from '../fixtures/auth';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

test.describe('Admin smoke', () => {
  let testSubmissionId: string;
  // createClient is deferred to beforeAll to ensure env vars are loaded by Playwright
  let supabaseAdmin: AnySupabaseClient;

  test.beforeAll(async () => {
    supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    // Create a test submission via Supabase directly for approve/reject test
    const { data } = await supabaseAdmin
      .from('brand_submissions')
      .insert({
        brand_name: '[E2E-TEST] Admin Smoke Brand',
        website_url: 'https://e2e-test.example.com',
        status: 'pending',
        submitted_by_email: process.env.E2E_USER_EMAIL,
      })
      .select('id')
      .single();
    testSubmissionId = data?.id;
  });

  test.afterAll(async () => {
    if (testSubmissionId && supabaseAdmin) {
      await supabaseAdmin.from('brand_submissions').delete().eq('id', testSubmissionId);
    }
  });

  test('admin dashboard loads', async ({ adminPage }) => {
    await adminPage.goto('/admin');
    await expect(adminPage.getByRole('heading', { name: /admin|dashboard/i })).toBeVisible({ timeout: 10_000 });
    // Stats should be visible
    await expect(adminPage.locator('.font-heading.text-4xl').first()).toBeVisible();
  });

  test('submissions review queue shows pending items', async ({ adminPage }) => {
    await adminPage.goto('/admin/submissions');
    await expect(adminPage.getByRole('heading', { name: /submission/i })).toBeVisible();
    // Test submission should appear
    await expect(adminPage.getByText('[E2E-TEST] Admin Smoke Brand')).toBeVisible({ timeout: 10_000 });
  });

  test('admin can approve a submission', async ({ adminPage }) => {
    await adminPage.goto('/admin/submissions');
    // Find and approve the test submission
    const row = adminPage.locator('tr, [role="row"]').filter({ hasText: '[E2E-TEST] Admin Smoke Brand' });
    const approveBtn = row.getByRole('button', { name: /approve/i });
    await approveBtn.click();
    // Confirm dialog or toast
    const confirmBtn = adminPage.getByRole('button', { name: /confirm|yes|approve/i }).last();
    if (await confirmBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await confirmBtn.click();
    }
    // Success feedback
    await expect(adminPage.getByText(/approved|success/i)).toBeVisible({ timeout: 10_000 });
  });
});
