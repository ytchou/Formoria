import { createClient } from '@supabase/supabase-js';
import { test, expect } from '../fixtures/auth';

test.describe('Admin reports deep', () => {
  let supabase: ReturnType<typeof createClient> | null = null;
  let seededReportId: string | null = null;
  let seededReportNote: string | null = null;

  test.beforeAll(async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return;

    supabase = createClient(url, key);

    const { data: brand, error: brandError } = await supabase
      .from('brands')
      .select('id')
      .limit(1)
      .maybeSingle();

    if (brandError || !brand?.id) return;

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
    await adminPage.goto('/admin/reports');

    await expect(
      adminPage.getByRole('heading', { name: '品牌檢舉' })
    ).toBeVisible({ timeout: 10_000 });

    const table = adminPage.locator('table').first();
    const emptyState = adminPage.getByText('目前沒有待處理的檢舉。');

    await expect(table.or(emptyState)).toBeVisible({ timeout: 10_000 });

    if (await table.isVisible()) {
      await expect(adminPage.getByRole('columnheader', { name: '品牌' })).toBeVisible();
      await expect(adminPage.getByRole('columnheader', { name: '原因' })).toBeVisible();
      await expect(adminPage.getByRole('columnheader', { name: '補充' })).toBeVisible();
      await expect(adminPage.getByRole('columnheader', { name: '日期' })).toBeVisible();
      await expect(adminPage.getByRole('columnheader', { name: '操作' })).toBeVisible();
    }

    await expect(
      adminPage.getByText(/something went wrong|minified react error/i)
    ).not.toBeVisible();
  });

  test('seeded pending report appears when safe seeding succeeds', async ({ adminPage }) => {
    test.skip(
      !seededReportId || !seededReportNote,
      'Skipped because no existing brand was available for safe report seeding.'
    );

    await adminPage.goto('/admin/reports');

    const seededRow = adminPage.locator('tbody tr', { hasText: seededReportNote! });

    await expect(seededRow).toBeVisible({ timeout: 10_000 });
    await expect(seededRow.getByText('資訊有誤')).toBeVisible();
    await expect(seededRow.getByRole('button', { name: '審核' })).toBeVisible();
    await expect(seededRow.getByRole('button', { name: '忽略' })).toBeVisible();
  });
});
