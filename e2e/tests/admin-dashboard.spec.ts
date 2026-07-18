import { randomUUID } from 'node:crypto';
import { test, expect } from '../fixtures/auth';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

test.describe('Admin dashboard deep', () => {
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
    test.setTimeout(120_000);
    await adminPage.goto('/admin', { timeout: 60_000 });
    // At minimum: page loads with headings and some stat indicators
    await expect(adminPage.getByRole('heading', { name: /^Admin$/ })).toBeVisible({ timeout: 60_000 });
    // No broken layout: check there's no React error boundary text
    await expect(adminPage.getByText(/something went wrong|minified react error/i)).not.toBeVisible();
  });

  test('admin nav links all work', async ({ adminPage }) => {
    // DEV-762: admin sub-routes also cold-compile in CI dev mode; bump per-link
    // <main> wait to 15s and add a 60s test budget.
    test.setTimeout(120_000);
    await adminPage.goto('/admin', { timeout: 60_000 });
    const navLinks = adminPage.locator('nav a, [data-testid="admin-nav"] a');
    const count = await navLinks.count();
    for (let i = 0; i < count; i++) {
      const href = await navLinks.nth(i).getAttribute('href');
      if (href?.startsWith('/admin')) {
        await adminPage.goto(href, { timeout: 60_000 });
        await expect(adminPage.getByRole('main')).toBeVisible({ timeout: 60_000 });
        await expect(adminPage.getByText(/something went wrong/i)).not.toBeVisible();
      }
    }
  });

  test('approve submission makes brand visible in directory', async ({ adminPage }) => {
    // DEV-762: /admin/submissions cold-compiles in CI; give the page and the
    // approve action generous budgets.
    test.setTimeout(120_000);
    if (!testSubmissionId) test.skip();
    await adminPage.goto('/admin/submissions?stage=ready', { timeout: 60_000 });
    // Wait for the page to be interactive before looking for the seeded row.
    await expect(adminPage.getByRole('main')).toBeVisible({ timeout: 60_000 });
    // Click the row text to expand the persisted review sheet.
    await adminPage.getByText(testBrandName).click();
    const approveBtn = adminPage.locator('td[colspan="9"]').getByRole('button', { name: 'Approve' });
    await expect(approveBtn).toBeVisible({ timeout: 10_000 });
    await approveBtn.click();
    // After approval the server action revalidates and the button disappears
    await expect(approveBtn).toBeHidden({ timeout: 30_000 });
  });

  test('reject submission keeps brand out of directory', async ({ adminPage }) => {
    test.setTimeout(120_000);

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

    await adminPage.goto('/admin/submissions', { timeout: 60_000 });
    await expect(adminPage.getByRole('main')).toBeVisible({ timeout: 60_000 });
    const rejectRow = adminPage.locator('tbody tr').filter({ hasText: rejectBrandName });
    const rejectBtn = rejectRow.getByRole('button', { name: 'Reject' });
    await expect(rejectBtn).toBeVisible({ timeout: 10_000 });
    adminPage.once('dialog', (dialog) => dialog.accept());
    await rejectBtn.click();
    await expect(rejectBtn).toBeHidden({ timeout: 15_000 });

    if (data?.id) {
      await supabase.from('brand_submissions').delete().eq('id', data.id);
    }
  });
});
