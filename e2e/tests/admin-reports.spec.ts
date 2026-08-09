import { createClient } from '@supabase/supabase-js';
import { test, expect } from '../fixtures/auth';
import { seedBrand, type SeededBrand } from '../helpers/seed';

import { BUDGET } from '../budgets';
test.describe('Admin reports deep', () => {
  test.beforeEach(() => {
    const adminEmail = process.env.E2E_ADMIN_EMAIL;
    const list = (process.env.ADMIN_EMAILS ?? '').split(',').map(e => e.trim());
    test.skip(!adminEmail || !list.includes(adminEmail),
      'E2E_ADMIN_EMAIL not in ADMIN_EMAILS — admin tests require matching env');
  });

  let supabase: ReturnType<typeof createClient> | null = null;
  let seededBrand: SeededBrand | null = null;
  let seededReportId: string | null = null;
  let seededReportNote: string | null = null;
  let seededReportBrandName: string | null = null;

  // Seeding failures are thrown, not swallowed. This hook used to `return` on a
  // missing brand or a failed insert, leaving `seededReportId` unset — and the
  // test below skipped itself on exactly that, so a broken report insert was
  // reported as a green run that had asserted nothing (DEV-1414). It also picked
  // an arbitrary existing brand with `.limit(1)`, which made the whole spec
  // depend on production data volume; it seeds its own brand now, so the
  // precondition can no longer be absent and the skip is gone with it.
  test.beforeAll(async ({}, workerInfo) => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error(
        'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to seed admin reports.',
      );
    }

    supabase = createClient(url, key);

    seededBrand = await seedBrand({
      name: 'reports',
      status: 'approved',
      workerIndex: workerInfo.workerIndex,
    });
    seededReportBrandName = seededBrand.brand.name;
    seededReportNote = `[E2E-TEST] reports ${Date.now()}`;

    const { data: report, error: reportError } = await supabase
      .from('brand_reports')
      .insert({
        brand_id: seededBrand.brand.id,
        reason: 'incorrect_info',
        notes: seededReportNote,
        status: 'pending',
      })
      .select('id')
      .single();

    if (reportError || !report?.id) {
      throw new Error(`Failed to seed brand report: ${reportError?.message ?? 'no row returned'}`);
    }

    seededReportId = report.id as string;
  });

  test.afterAll(async () => {
    if (supabase && seededReportId) {
      await supabase.from('brand_reports').delete().eq('id', seededReportId);
    }
    await seededBrand?.cleanup();
  });

  test('reports page renders heading and table columns or empty state', async ({ adminPage }) => {
    // DEV-762: admin sub-routes cold-compile in CI dev mode; give generous budget
    test.setTimeout(BUDGET.TEST.ADMIN);
    await adminPage.goto('/admin/reports');
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

  test('seeded pending report appears in the reports table', async ({ adminPage }) => {
    // No skip guard here any more. It used to skip when the seed had silently
    // failed, which is the one circumstance under which this test most needs to
    // run — the seed now throws instead, so reaching this line means the report
    // exists (DEV-1414).
    // DEV-762: admin sub-routes cold-compile in CI dev mode; give generous budget
    test.setTimeout(BUDGET.TEST.ADMIN);
    await adminPage.goto('/admin/reports');
    // Wait for main to confirm the page loaded before looking for the seeded row
    await expect(adminPage.getByRole('main')).toBeVisible({ timeout: 60_000 });

    const seededRow = adminPage.locator('tbody tr', { hasText: seededReportBrandName! }).filter({
      hasText: 'Incorrect information',
    }).first();

    await expect(seededRow).toBeVisible({ timeout: 15_000 });
    await expect(seededRow.getByText('Incorrect information')).toBeVisible();
    await expect(seededRow.getByText('Pending')).toBeVisible();

    await seededRow.click();

    const drawer = adminPage.getByRole('dialog');
    await expect(drawer).toBeVisible({ timeout: 10_000 });
    await expect(drawer.getByText(seededReportNote!, { exact: true })).toBeVisible();
    await expect(drawer.getByRole('button', { name: 'Mark reviewed' })).toBeVisible();
    await expect(drawer.getByRole('button', { name: 'Dismiss' })).toBeVisible();
  });
});
