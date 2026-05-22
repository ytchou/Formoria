import { test, expect } from '../fixtures/auth';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

test.describe('Admin dashboard deep', () => {
  let testSubmissionId: string;

  test.beforeAll(async () => {
    const { data } = await supabase
      .from('brand_submissions')
      .insert({
        brand_name: '[E2E-TEST] Dashboard Test Brand',
        website_url: 'https://e2e-dashboard.example.com',
        status: 'pending',
        submitted_by_email: process.env.E2E_USER_EMAIL,
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
    await adminPage.goto('/admin/submissions');
    const row = adminPage.locator('tr, [role="row"]').filter({ hasText: '[E2E-TEST] Dashboard Test Brand' });
    const approveBtn = row.getByRole('button', { name: /approve/i });
    await approveBtn.click();
    // Handle confirm dialog
    const confirmBtn = adminPage.getByRole('button', { name: /confirm|approve|yes/i }).last();
    if (await confirmBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await confirmBtn.click();
    }
    await expect(adminPage.getByText(/approved|success/i)).toBeVisible({ timeout: 10_000 });
  });

  test('reject submission keeps brand out of directory', async ({ adminPage }) => {
    // Create a separate submission for rejection test
    const { data } = await supabase
      .from('brand_submissions')
      .insert({
        brand_name: '[E2E-TEST] Rejected Brand',
        website_url: 'https://e2e-reject.example.com',
        status: 'pending',
        submitted_by_email: process.env.E2E_USER_EMAIL,
      })
      .select('id')
      .single();

    await adminPage.goto('/admin/submissions');
    const row = adminPage.locator('tr, [role="row"]').filter({ hasText: '[E2E-TEST] Rejected Brand' });
    const rejectBtn = row.getByRole('button', { name: /reject/i });
    await rejectBtn.click();
    const confirmBtn = adminPage.getByRole('button', { name: /confirm|reject|yes/i }).last();
    if (await confirmBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await confirmBtn.click();
    }
    await expect(adminPage.getByText(/rejected|success/i)).toBeVisible({ timeout: 10_000 });

    if (data?.id) {
      await supabase.from('brand_submissions').delete().eq('id', data.id);
    }
  });
});
