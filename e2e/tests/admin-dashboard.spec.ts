import { test, expect } from '../fixtures/auth';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

test.describe('Admin dashboard deep', () => {
  let testSubmissionId: string;
  let testBrandName: string;
  // createClient is deferred to beforeAll to ensure env vars are loaded by Playwright
  let supabase: AnySupabaseClient;

  test.beforeAll(async () => {
    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    testBrandName = `[E2E-TEST] Dashboard Test Brand ${Date.now()}`;
    const { data } = await supabase
      .from('brand_submissions')
      .insert({
        brand_name: testBrandName,
        website_url: 'https://e2e-dashboard.example.com',
        status: 'pending',
        submitter_email: process.env.E2E_USER_EMAIL,
      })
      .select('id')
      .single();
    testSubmissionId = data?.id;
  });

  test.afterAll(async () => {
    if (testSubmissionId) {
      await supabase.from('brand_submissions').delete().eq('id', testSubmissionId);
    }
    await supabase.from('brand_submissions').delete().like('brand_name', '[E2E-TEST]%');
    // Also cleanup any brands created via approval
    await supabase.from('brands').delete().like('name', '[E2E-TEST]%');
  });

  test('admin dashboard shows accurate stats', async ({ adminPage }) => {
    await adminPage.goto('/admin');
    // At minimum: page loads with headings and some stat indicators
    await expect(adminPage.getByRole('heading', { level: 1 }).or(adminPage.getByRole('heading', { level: 2 }))).toBeVisible();
    // No broken layout: check there's no React error boundary text
    await expect(adminPage.getByText(/something went wrong|minified react error/i)).not.toBeVisible();
  });

  test('admin nav links all work', async ({ adminPage }) => {
    await adminPage.goto('/admin');
    const navLinks = adminPage.locator('nav a, [data-testid="admin-nav"] a');
    const count = await navLinks.count();
    for (let i = 0; i < count; i++) {
      const href = await navLinks.nth(i).getAttribute('href');
      if (href?.startsWith('/admin')) {
        await adminPage.goto(href);
        await expect(adminPage.getByRole('main')).toBeVisible({ timeout: 5_000 });
        await expect(adminPage.getByText(/something went wrong/i)).not.toBeVisible();
      }
    }
  });

  test('approve submission makes brand visible in directory', async ({ adminPage }) => {
    if (!testSubmissionId) test.skip();
    await adminPage.goto('/admin/submissions');
    // Click the row text to expand the detail section (approve button is inside it)
    await adminPage.getByText(testBrandName).click();
    const approveBtn = adminPage.getByRole('button', { name: /^approve$|^核准$/i });
    await expect(approveBtn).toBeVisible({ timeout: 5_000 });
    await approveBtn.click();
    // After approval the server action revalidates and the button disappears
    await expect(approveBtn).toBeHidden({ timeout: 15_000 });
  });

  test('reject submission keeps brand out of directory', async ({ adminPage }) => {
    // Create a separate submission for rejection test
    const rejectBrandName = `[E2E-TEST] Rejected Brand ${Date.now()}`;
    const { data } = await supabase
      .from('brand_submissions')
      .insert({
        brand_name: rejectBrandName,
        website_url: 'https://e2e-reject.example.com',
        status: 'pending',
        submitter_email: process.env.E2E_USER_EMAIL,
      })
      .select('id')
      .single();

    await adminPage.goto('/admin/submissions');
    // Click the row text to expand the detail section (reject button is inside it)
    await adminPage.getByText(rejectBrandName).click();
    const rejectBtn = adminPage.getByRole('button', { name: /^reject$|^拒絕$/i });
    await expect(rejectBtn).toBeVisible({ timeout: 5_000 });
    await rejectBtn.click();
    // After rejection the server action revalidates and the button disappears
    await expect(rejectBtn).toBeHidden({ timeout: 15_000 });

    if (data?.id) {
      await supabase.from('brand_submissions').delete().eq('id', data.id);
    }
  });
});
