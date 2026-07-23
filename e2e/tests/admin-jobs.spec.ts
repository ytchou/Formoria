import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { test, expect } from '../fixtures/auth';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

test.describe('Admin curation jobs deep', () => {
  test.beforeEach(() => {
    const adminEmail = process.env.E2E_ADMIN_EMAIL;
    const list = (process.env.ADMIN_EMAILS ?? '').split(',').map((email) => email.trim());
    test.skip(
      !adminEmail || !list.includes(adminEmail),
      'E2E_ADMIN_EMAIL not in ADMIN_EMAILS — admin tests require matching env',
    );
  });

  let supabase: AnySupabaseClient;
  let parentJobId: string;
  let childJobId: string | undefined;
  let cancellableJobId: string | undefined;
  let brandName: string;
  let brandSlug: string;
  let targetId: string;
  let phaseError: string;

  test.beforeAll(async () => {
    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    brandName = `[E2E-TEST] Durable jobs ${suffix}`;
    brandSlug = `e2e-durable-jobs-${suffix}`;
    targetId = randomUUID();
    phaseError = 'Description provider returned invalid data';

    const { error: submissionError } = await supabase
      .from('brand_submissions')
      .insert({
        id: targetId,
        brand_name: brandName,
        submitter_email: 'e2e-admin-jobs@test.example',
        status: 'pending',
        intent: 'recommend',
      });

    if (submissionError) {
      throw new Error(`brand submission seed failed: ${submissionError.message}`);
    }

    const { data: jobId, error: enqueueError } = await supabase.rpc('enqueue_curation_job', {
      p_operation: 'enrich',
      p_params: { target: 'submissions', submissionIds: [targetId] },
      p_dry_run: false,
      p_started_by: 'e2e-admin-jobs',
      p_trigger: 'admin',
      p_parent_job_id: null,
      p_attempt: 1,
      p_scheduled_for: null,
      p_run_after: '2099-01-01T00:00:00.000Z',
      p_dedupe_key: `e2e-admin-jobs:${randomUUID()}`,
      p_targets: [
        {
          target_type: 'submission',
          target_id: targetId,
          brand_name: brandName,
          brand_slug: brandSlug,
        },
      ],
    });

    if (enqueueError || !jobId) {
      throw new Error(`curation job seed failed: ${enqueueError?.message ?? 'missing job id'}`);
    }
    parentJobId = jobId;

    const { data: activeJobId, error: activeJobError } = await supabase.rpc('enqueue_curation_job', {
      p_operation: 'enrich',
      p_params: { target: 'brands', slugs: [brandSlug] },
      p_dry_run: false,
      p_started_by: 'e2e-admin-jobs-cancel',
      p_trigger: 'admin',
      p_parent_job_id: null,
      p_attempt: 1,
      p_scheduled_for: null,
      p_run_after: '2099-01-01T00:00:00.000Z',
      p_dedupe_key: `e2e-admin-jobs-cancel:${randomUUID()}`,
      p_targets: [{ target_type: 'brand', target_id: randomUUID(), brand_name: `${brandName} cancel`, brand_slug: null }],
    });
    if (activeJobError || !activeJobId) throw new Error(`active job seed failed: ${activeJobError?.message ?? 'missing job id'}`);
    cancellableJobId = activeJobId;

    const completedAt = new Date().toISOString();
    const startedAt = new Date(Date.now() - 1_500).toISOString();
    const { error: targetError } = await supabase
      .from('curation_job_targets')
      .update({
        status: 'failed',
        current_phase: 'descriptions',
        phase_results: [
          {
            phase: 'descriptions',
            status: 'failed',
            changedFields: ['description'],
            durationMs: 1500,
            error: phaseError,
          },
        ],
        changed_fields: ['description'],
        error: phaseError,
        started_at: startedAt,
        completed_at: completedAt,
        duration_ms: 1500,
      })
      .eq('job_id', parentJobId)
      .eq('target_id', targetId);

    if (targetError) {
      throw new Error(`curation target seed failed: ${targetError.message}`);
    }

    const { error: jobError } = await supabase
      .from('curation_jobs')
      .update({
        status: 'completed',
        started_at: startedAt,
        completed_at: completedAt,
        target_total: 1,
        succeeded_count: 0,
        skipped_count: 0,
        failed_count: 1,
        result: { success: 0, skipped: 0, failed: 1 },
      })
      .eq('id', parentJobId);

    if (jobError) {
      throw new Error(`curation job completion seed failed: ${jobError.message}`);
    }
  });

  test.afterAll(async () => {
    if (!supabase || !parentJobId) return;

    const { data: childJobs, error: childLookupError } = await supabase
      .from('curation_jobs')
      .select('id')
      .eq('parent_job_id', parentJobId);
    if (childLookupError) {
      console.warn(`[e2e-cleanup] child job lookup failed: ${childLookupError.message}`);
    }

    const childIds = Array.from(
      new Set([
        ...(childJobs ?? []).map((job: { id: string }) => job.id),
        ...(childJobId ? [childJobId] : []),
      ]),
    );
    if (cancellableJobId) childIds.push(cancellableJobId);
    if (childIds.length > 0) {
      const { error: childDeleteError } = await supabase
        .from('curation_jobs')
        .delete()
        .in('id', childIds);
      if (childDeleteError) {
        console.warn(`[e2e-cleanup] child job deletion failed: ${childDeleteError.message}`);
      }
    }

    const { error: parentDeleteError } = await supabase
      .from('curation_jobs')
      .delete()
      .eq('id', parentJobId);
    if (parentDeleteError) {
      console.warn(`[e2e-cleanup] parent job deletion failed: ${parentDeleteError.message}`);
    }

    if (targetId) {
      const { error: submissionDeleteError } = await supabase
        .from('brand_submissions')
        .delete()
        .eq('id', targetId);
      if (submissionDeleteError) {
        console.warn(`[e2e-cleanup] brand submission deletion failed: ${submissionDeleteError.message}`);
      }
    }
  });

  test('admin sees one job log and cancels active work', async ({ adminPage }) => {
    test.setTimeout(120_000);
    if (!cancellableJobId) test.skip();
    await adminPage.goto('/admin/jobs', { timeout: 60_000 });
    await expect(adminPage.getByRole('navigation', { name: 'Filter data jobs' })).toHaveCount(0);
    const row = adminPage.locator('tbody tr').filter({ has: adminPage.locator(`a[href="/admin/jobs/${cancellableJobId}"]`) });
    await expect(row).toBeVisible({ timeout: 60_000 });
    await row.getByRole('button', { name: 'Cancel job' }).click();
    const dialog = adminPage.getByRole('alertdialog');
    await expect(dialog.getByRole('heading', { name: 'Cancel this job?' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel job' }).click();
    await expect(row.locator('[data-slot="badge"]', { hasText: 'Cancelled' })).toBeVisible({ timeout: 30_000 });
  });

  test('admin reviews a failed curation target and manually reruns it', async ({ adminPage }) => {
    test.setTimeout(120_000);

    await adminPage.goto('/admin/jobs', { timeout: 60_000 });
    await expect(adminPage.getByRole('heading', { name: 'Data Jobs' })).toBeVisible({ timeout: 60_000 });

    const historyLink = adminPage.locator(`a[href="/admin/jobs/${parentJobId}"]`);
    const historyRow = adminPage.locator('tbody tr').filter({ has: historyLink });
    await expect(async () => {
      await adminPage.reload({ timeout: 60_000 });
      await expect(historyLink).toHaveCount(1);
      await expect(historyRow).toBeVisible();
      await expect(historyRow).toContainText('Completed with failures');
      await expect(historyRow).toContainText('0 ok, 0 skipped, 1 failed');
    }).toPass({ timeout: 60_000, intervals: [3_000, 5_000, 10_000] });

    await historyLink.click();
    await expect(adminPage).toHaveURL(new RegExp(`/admin/jobs/${parentJobId}$`), { timeout: 60_000 });
    await expect(adminPage.getByRole('heading', { name: 'Job Detail' })).toBeVisible({ timeout: 60_000 });
    await expect(adminPage.getByText(parentJobId, { exact: true })).toBeVisible();

    const triggerField = adminPage.getByText('Trigger', { exact: true }).locator('..');
    const attemptField = adminPage.getByText('Attempt', { exact: true }).locator('..');
    const startedByField = adminPage.getByText('Started by', { exact: true }).locator('..');
    await expect(triggerField).toContainText('Admin');
    await expect(attemptField).toContainText('1');
    await expect(startedByField).toContainText('e2e-admin-jobs');

    const targetRow = adminPage.locator('tbody tr').filter({ hasText: brandName });
    await expect(targetRow).toBeVisible();
    await expect(targetRow).toContainText('Failed');
    await expect(targetRow).toContainText('descriptions');

    const detailsToggle = targetRow.getByText('View details', { exact: true });
    await expect(detailsToggle).toHaveCount(1);
    await detailsToggle.click();

    const details = targetRow.locator('details');
    await expect(details).toHaveAttribute('open', '');
    await expect(details).toContainText(brandSlug);
    await expect(details).toContainText('description');
    await expect(details).toContainText(phaseError);

    const rerunButton = adminPage.getByRole('button', { name: 'Rerun failed submissions', exact: true });
    await expect(rerunButton).toBeVisible();
    await rerunButton.click();

    await expect
      .poll(
        () => new URL(adminPage.url()).pathname,
        { timeout: 60_000, intervals: [500, 1_000, 2_000, 5_000] },
      )
      .toMatch(new RegExp(`^/admin/jobs/(?!${parentJobId}$)[^/]+$`));

    const childPath = new URL(adminPage.url()).pathname;
    const childMatch = /^\/admin\/jobs\/([^/]+)$/.exec(childPath);
    const rerunId = childMatch?.[1];
    if (!rerunId) throw new Error(`Unable to identify rerun job from URL: ${childPath}`);
    childJobId = rerunId;
    expect(childJobId).not.toBe(parentJobId);

    const childTargetRow = adminPage.locator('tbody tr').filter({ hasText: brandName });
    const parentLineageLink = adminPage.getByRole('link', {
      name: 'Previous job (attempt 1)',
      exact: true,
    });
    await expect(async () => {
      await adminPage.reload({ timeout: 60_000 });
      const childTriggerField = adminPage.getByText('Trigger', { exact: true }).locator('..');
      await expect(childTriggerField).toContainText('Manual rerun');
      await expect(childTargetRow).toBeVisible();
      await expect(childTargetRow).toContainText(brandName);
      await expect(parentLineageLink).toHaveAttribute('href', `/admin/jobs/${parentJobId}`);
    }).toPass({ timeout: 60_000, intervals: [3_000, 5_000, 10_000] });

    const childDetailsToggle = childTargetRow.getByText('View details', { exact: true });
    await expect(childDetailsToggle).toHaveCount(1);
    await childDetailsToggle.click();
    await expect(childTargetRow.locator('details')).toContainText(brandSlug);
  });
});
