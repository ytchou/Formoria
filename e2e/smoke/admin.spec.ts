import { test, expect } from '../fixtures/auth';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

test.describe('Admin smoke', () => {
  let testSubmissionId: string;
  let testBrandName: string;
  let supabaseAdmin: AnySupabaseClient;

  test.beforeAll(async () => {
    supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    testBrandName = `[E2E-TEST] Admin Smoke ${Date.now()}`;
    const { data, error } = await supabaseAdmin
      .from('brand_submissions')
      .insert({
        brand_name: testBrandName,
        website_url: 'https://e2e-test.example.com',
        status: 'pending',
        submitter_email: process.env.E2E_USER_EMAIL,
      })
      .select('id')
      .single();
    if (error) throw new Error(`Failed to create test submission: ${error.message}`);
    testSubmissionId = data?.id;
  });

  test.afterAll(async () => {
    if (!supabaseAdmin) return;

    // Resolve the approved brand by name (may not exist if the approval test was skipped/failed)
    let approvedBrandId: string | null = null;
    if (testBrandName) {
      const { data: brandRow } = await supabaseAdmin
        .from('brands')
        .select('id')
        .eq('name', testBrandName)
        .maybeSingle();
      approvedBrandId = brandRow?.id ?? null;
    }

    // Delete submission first — brand_submissions.brand_id FK has no ON DELETE CASCADE,
    // so the submission must be gone before we can delete the brand.
    if (testSubmissionId) {
      await supabaseAdmin.from('brand_submissions').delete().eq('id', testSubmissionId);
    }

    // Delete the approved brand (cascades to brand_owners, brand_taxonomy, etc.)
    if (approvedBrandId) {
      await supabaseAdmin.from('brands').delete().eq('id', approvedBrandId);
    }
  });

  test('admin dashboard loads', async ({ adminPage }) => {
    test.setTimeout(120_000);

    await adminPage.goto('/admin', { timeout: 60_000 });
    await expect(adminPage.getByRole('heading', { name: '管理後台' }).first()).toBeVisible({ timeout: 60_000 });
    // Stats should be visible — use stable text labels rather than fragile CSS class selectors
    await expect(adminPage.getByText('品牌總數').first()).toBeVisible();
  });

  test('submissions review queue shows pending items', async ({ adminPage }) => {
    test.setTimeout(120_000);

    if (!testSubmissionId) test.skip();
    await adminPage.goto('/admin/review-queue/submissions', { timeout: 60_000 });
    await expect(adminPage.getByRole('heading', { name: /submission/i })).toBeVisible({ timeout: 30_000 });
    await expect(adminPage.getByText(testBrandName)).toBeVisible({ timeout: 10_000 });
  });

  test('admin can approve a submission', async ({ adminPage }) => {
    test.setTimeout(120_000);

    if (!testSubmissionId) test.skip();
    await adminPage.goto('/admin/review-queue/submissions', { timeout: 60_000 });
    // Click the row to expand the detail section (approve button is inside it)
    await adminPage.getByText(testBrandName).click();
    const approveBtn = adminPage.getByRole('button', { name: /^approve$|^核准$/i });
    await expect(approveBtn).toBeVisible({ timeout: 5_000 });
    await approveBtn.click();
    // After approval the server action revalidates and the button disappears
    await expect(approveBtn).toBeHidden({ timeout: 15_000 });
  });
});
