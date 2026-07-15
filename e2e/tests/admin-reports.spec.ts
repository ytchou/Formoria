import { createClient } from '@supabase/supabase-js';
import { test, expect } from '../fixtures/auth';

test.describe('Admin reports deep', () => {
  test.beforeEach(() => {
    const adminEmail = process.env.E2E_ADMIN_EMAIL;
    const list = (process.env.ADMIN_EMAILS ?? '').split(',').map(e => e.trim());
    test.skip(!adminEmail || !list.includes(adminEmail),
      'E2E_ADMIN_EMAIL not in ADMIN_EMAILS — admin tests require matching env');
  });

  let supabase: ReturnType<typeof createClient> | null = null;
  let seededReportId: string | null = null;
  let seededReportNote: string | null = null;
  let seededReportBrandName: string | null = null;

  test.beforeAll(async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return;

    supabase = createClient(url, key);

    const { data: brand, error: brandError } = await supabase
      .from('brands')
      .select('id, name')
      .limit(1)
      .maybeSingle();

    if (brandError || !brand?.id) return;
    seededReportBrandName = brand.name;

    seededReportNote = `[E2E-TEST] reports ${Date.now()}`;

    const { data: report, error: reportError } = await supabase
      .from('brand_reports')
      .insert({
        brand_id: brand.id,
        reason: 'incorrect_info',
        notes: seededReportNote,
        status: 'pending',
      })
      .select('id')
      .single();

    if (reportError || !report?.id) {
      seededReportNote = null;
      return;
    }

    seededReportId = report.id;
  });

  test.afterAll(async () => {
    if (!supabase || !seededReportId) return;

    await supabase.from('brand_reports').delete().eq('id', seededReportId);
  });

  test('reports page renders heading and table columns or empty state', async ({ adminPage }) => {
    // DEV-762: admin sub-routes cold-compile in CI dev mode; give generous budget
    test.setTimeout(120_000);
    await adminPage.goto('/admin/reports', { timeout: 60_000 });
    await expect(adminPage.getByRole('main')).toBeVisible({ timeout: 60_000 });

    await expect(
      adminPage.getByRole('heading', { name: 'Brand Reports' })
    ).toBeVisible({ timeout: 60_000 });

    const table = adminPage.locator('table').first();
    const emptyState = adminPage.getByText('No pending reports.');

    await expect(table.or(emptyState)).toBeVisible({ timeout: 10_000 });

    if (await table.isVisible()) {
      await expect(adminPage.getByRole('columnheader', { name: 'Brand' })).toBeVisible();
      await expect(adminPage.getByRole('columnheader', { name: 'Reason' })).toBeVisible();
      await expect(adminPage.getByRole('columnheader', { name: 'Date' })).toBeVisible();
      await expect(adminPage.getByRole('columnheader', { name: 'Status' })).toBeVisible();
    }

    await expect(
      adminPage.getByText(/something went wrong|minified react error/i)
    ).not.toBeVisible();
  });

  test('seeded pending report appears when safe seeding succeeds', async ({ adminPage }) => {
    test.skip(
      !seededReportId || !seededReportNote || !seededReportBrandName,
      'Skipped because no existing brand was available for safe report seeding.'
    );
    // DEV-762: admin sub-routes cold-compile in CI dev mode; give generous budget
    test.setTimeout(120_000);

    await adminPage.goto('/admin/reports', { timeout: 60_000 });
    // Wait for main to confirm the page loaded before looking for the seeded row
    await expect(adminPage.getByRole('main')).toBeVisible({ timeout: 60_000 });

    const seededRow = adminPage.locator('tbody tr', { hasText: seededReportBrandName! }).filter({
      hasText: 'Incorrect information',
    }).first();

    await expect(seededRow).toBeVisible({ timeout: 15_000 });
    await expect(seededRow.getByText('Incorrect information')).toBeVisible();
    await expect(seededRow.getByText('Pending')).toBeVisible();

    await seededRow.click();

    const expandedRow = adminPage.locator('tbody tr', { hasText: seededReportNote! });
    await expect(expandedRow).toBeVisible({ timeout: 10_000 });
    await expect(expandedRow.getByRole('button', { name: 'Mark reviewed' })).toBeVisible();
    await expect(expandedRow.getByRole('button', { name: 'Dismiss' })).toBeVisible();
  });
});
