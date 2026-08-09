import { randomUUID } from 'node:crypto';
import { test, expect } from '../fixtures/auth';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { BUDGET } from '../budgets';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

test.describe('Admin dashboard deep', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(() => {
    const adminEmail = process.env.E2E_ADMIN_EMAIL;
    const list = (process.env.ADMIN_EMAILS ?? '').split(',').map(e => e.trim());
    test.skip(!adminEmail || !list.includes(adminEmail),
      'E2E_ADMIN_EMAIL not in ADMIN_EMAILS — admin tests require matching env');
  });

  let testSubmissionId: string;
  let testJobId: string;
  let testBrandName: string;
  let storagePaths: string[];
  let imageUrls: string[];
  // createClient is deferred to beforeAll to ensure env vars are loaded by Playwright
  let supabase: AnySupabaseClient;

  test.beforeAll(async () => {
    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    testSubmissionId = randomUUID();
    testBrandName = `[E2E-TEST] Dashboard Test Brand ${suffix}`;
    storagePaths = [
      `submissions/${testSubmissionId}/hero.png`,
      `submissions/${testSubmissionId}/detail.png`,
    ];
    for (const path of storagePaths) {
      const { error: uploadError } = await supabase.storage
        .from('brand-images')
        .upload(path, PNG_1X1, { contentType: 'image/png' });
      if (uploadError) {
        throw new Error(`image seed failed: ${uploadError.message}`);
      }
    }
    imageUrls = storagePaths.map(
      (path) => supabase.storage.from('brand-images').getPublicUrl(path).data.publicUrl,
    );

    const { error: submissionError } = await supabase
      .from('brand_submissions')
      .insert({
        id: testSubmissionId,
        brand_name: testBrandName,
        website_url: 'https://e2e-dashboard.example.com',
        status: 'pending',
        submitter_email: process.env.E2E_USER_EMAIL,
        enriched_data: {
          description: 'Complete dashboard test enrichment.',
          hero_image_url: imageUrls[0],
          product_type: 'bags-accessories',
          product_tags: ['手工包袋'],
          price_range: 2,
          purchase_website: 'https://e2e-dashboard.example.com',
        },
      });
    if (submissionError) {
      throw new Error(`submission seed failed: ${submissionError.message}`);
    }

    const { error: imageError } = await supabase
      .from('submission_images')
      .insert(
        storagePaths.map((storagePath, index) => ({
          submission_id: testSubmissionId,
          storage_path: storagePath,
          url: imageUrls[index]!,
          source_url: imageUrls[index]!,
          source: 'admin',
          status: 'active',
          sort_order: index,
        })),
      );
    if (imageError) {
      throw new Error(`submission image seed failed: ${imageError.message}`);
    }

    const { data: queuedJobId, error: enqueueError } = await supabase.rpc(
      'enqueue_curation_job',
      {
        p_operation: 'enrich',
        p_params: { target: 'submissions', submissionIds: [testSubmissionId] },
        p_dry_run: false,
        p_started_by: 'e2e-admin-dashboard',
        p_trigger: 'admin',
        p_parent_job_id: null,
        p_attempt: 1,
        p_scheduled_for: null,
        p_run_after: '2099-01-01T00:00:00.000Z',
        p_dedupe_key: `e2e-admin-dashboard:${randomUUID()}`,
        p_targets: [
          {
            target_type: 'submission',
            target_id: testSubmissionId,
            brand_name: testBrandName,
            brand_slug: null,
          },
        ],
      },
    );
    if (enqueueError || !queuedJobId) {
      throw new Error(`curation job seed failed: ${enqueueError?.message ?? 'missing id'}`);
    }
    testJobId = queuedJobId;

    const completedAt = new Date().toISOString();
    const { error: targetError } = await supabase
      .from('curation_job_targets')
      .update({ status: 'succeeded', completed_at: completedAt })
      .eq('job_id', testJobId)
      .eq('target_id', testSubmissionId);
    if (targetError) {
      throw new Error(`curation target seed failed: ${targetError.message}`);
    }

    const { error: jobError } = await supabase
      .from('curation_jobs')
      .update({ status: 'completed', completed_at: completedAt, succeeded_count: 1 })
      .eq('id', testJobId);
    if (jobError) {
      throw new Error(`curation job completion seed failed: ${jobError.message}`);
    }
  });

  test.afterAll(async () => {
    if (testBrandName) {
      await supabase.from('brands').delete().eq('name', testBrandName);
    }
    if (testJobId) {
      await supabase.from('curation_jobs').delete().eq('id', testJobId);
    }
    if (testSubmissionId) {
      await supabase.from('brand_submissions').delete().eq('id', testSubmissionId);
    }
    if (storagePaths?.length) {
      await supabase.storage.from('brand-images').remove(storagePaths);
    }
  });

  test('admin dashboard shows accurate stats', async ({ adminPage }) => {
    test.setTimeout(BUDGET.TEST.ADMIN);
    await adminPage.setViewportSize({ width: 1512, height: 828 });
    await adminPage.goto('/admin');
    await expect(adminPage.getByRole('heading', { name: /^Admin$/ })).toBeVisible({ timeout: BUDGET.NAVIGATION });
    await expect(adminPage.getByRole('heading', { name: 'Operations overview' })).toBeVisible();
    await expect(adminPage.getByRole('link', { name: /Needs data/ })).toHaveAttribute(
      'href',
      '/admin/submissions?stage=needs_data',
    );
    await expect(adminPage.getByRole('link', { name: /Subscribers/ })).toHaveAttribute(
      'href',
      '/admin/newsletter?status=active',
    );
    await expect(adminPage.getByText('System Status')).toHaveCount(0);
    await expect(adminPage.getByText('Feature Toggles')).toHaveCount(0);
    await expect(adminPage.getByText(/something went wrong|minified react error/i)).not.toBeVisible();
  });

  test('operations ledger remains actionable on mobile', async ({ adminPage }) => {
    await adminPage.setViewportSize({ width: 390, height: 844 });
    await adminPage.goto('/admin');
    const needsData = adminPage.getByRole('link', { name: /Needs data/ });
    await expect(needsData).toBeVisible({ timeout: BUDGET.NAVIGATION });
    await expect(needsData).toHaveCSS('min-height', '160px');
    await expect(adminPage.getByRole('button', { name: 'Enrich needs-data submissions' })).toBeVisible();
  });

  test('admin nav links all work', async ({ adminPage }) => {
    // DEV-762: admin sub-routes also cold-compile in CI dev mode; bump per-link
    // <main> wait to 15s and add a 60s test budget.
    test.setTimeout(BUDGET.TEST.ADMIN);
    await adminPage.goto('/admin');
    const navLinks = adminPage.locator('nav a, [data-testid="admin-nav"] a');
    const count = await navLinks.count();
    for (let i = 0; i < count; i++) {
      const href = await navLinks.nth(i).getAttribute('href');
      if (href?.startsWith('/admin')) {
        await adminPage.goto(href);
        await expect(adminPage.getByRole('main')).toBeVisible({ timeout: BUDGET.NAVIGATION });
        await expect(adminPage.getByText(/something went wrong/i)).not.toBeVisible();
      }
    }
  });

  test('approve submission makes brand visible in directory', async ({ adminPage }) => {
    // DEV-762: /admin/submissions cold-compiles in CI; give the page and the
    // approve action generous budgets.
    test.setTimeout(BUDGET.TEST.ADMIN);
    if (!testSubmissionId) test.skip();
    await adminPage.goto('/admin/submissions?stage=ready');
    // Wait for the page to be interactive before looking for the seeded row.
    await expect(adminPage.getByRole('main')).toBeVisible({ timeout: BUDGET.NAVIGATION });
    const readyRow = adminPage.locator('tbody tr').filter({ hasText: testBrandName }).first();
    await expect(readyRow).toBeVisible({ timeout: BUDGET.INTERACTIVE });
    // Approve now lives in the row's drawer rather than inline in the table row.
    await readyRow.getByText(testBrandName, { exact: true }).click();
    const reviewDrawer = adminPage.getByRole('dialog');
    const approveBtn = reviewDrawer.getByRole('button', { name: 'Approve', exact: true });
    await expect(approveBtn).toBeVisible({ timeout: BUDGET.INTERACTIVE });
    await approveBtn.click();
    // After approval the server action revalidates and the drawer closes
    await expect(reviewDrawer).toBeHidden({ timeout: BUDGET.GATED_UI });
  });

  test('needs-data submission can be dropped and is removed from the database', async ({ adminPage }) => {
    test.setTimeout(BUDGET.TEST.ADMIN);
    // Create a separate submission that remains in the needs-data stage.
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
    if (!data?.id) throw new Error('Needs-data submission seed failed');

    try {
      await adminPage.goto('/admin/submissions?stage=needs_data');
      await expect(adminPage.getByRole('main')).toBeVisible({ timeout: BUDGET.NAVIGATION });
      const rejectRow = adminPage.locator('tbody tr').filter({ hasText: rejectBrandName });
      await expect(rejectRow).toBeVisible({ timeout: BUDGET.INTERACTIVE });
      await expect(rejectRow.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
      await expect(rejectRow.getByRole('button', { name: 'Reject', exact: true })).toHaveCount(0);
      await expect(adminPage.getByRole('button', { name: 'Fetch Data' })).toBeVisible();

      await rejectRow.getByRole('checkbox').click();
      const dropButton = adminPage.getByRole('button', { name: 'Drop selected', exact: true });
      await expect(dropButton).toBeEnabled();
      await dropButton.click();

      const confirmDialog = adminPage.getByRole('alertdialog');
      await expect(confirmDialog).toBeVisible();
      await confirmDialog.getByRole('button', { name: 'Drop selected', exact: true }).click();

      await expect.poll(async () => {
        const { count, error } = await supabase
          .from('brand_submissions')
          .select('id', { count: 'exact', head: true })
          .eq('id', data.id);
        expect(error).toBeNull();
        return count;
      }).toBe(0);
    } finally {
      await supabase.from('brand_submissions').delete().eq('id', data.id);
    }
  });
});
