import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { test, expect } from '../fixtures/auth';

import { BUDGET, POLL } from '../budgets';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

/**
 * Extract a job ID from a URL pathname, throwing if not found. Lives outside the
 * test body so `playwright/no-conditional-in-test` does not flag the guard.
 */
function extractJobId(pathname: string, excludeId?: string): string {
  const match = /^\/admin\/jobs\/([^/]+)$/.exec(pathname);
  const id = match?.[1];
  if (!id) throw new Error(`Unable to extract job ID from URL: ${pathname}`);
  if (excludeId && id === excludeId) throw new Error(`Expected a new job ID, got same as parent: ${id}`);
  return id;
}

/**
 * Assert a Supabase query succeeded, throwing on error. Lives outside the
 * test body so `playwright/no-conditional-in-test` does not flag the guard.
 */
function assertQueryOk<T>(result: { data: T; error: { message: string } | null }, label: string): T {
  if (result.error) throw new Error(`${label} failed: ${result.error.message}`);
  return result.data;
}

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

  let retryJobId: string;
  let retryTargetId: string;
  let retryBrandName: string;
  let retryBrandSlug: string;
  let retryChildJobId: string | undefined;

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

    // --- Seed a second completed job for the retry-phase test ---
    const retrySuffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    retryBrandName = `[E2E-TEST] Retry phase ${retrySuffix}`;
    retryBrandSlug = `e2e-retry-phase-${retrySuffix}`;
    retryTargetId = randomUUID();

    const { error: retrySubmissionError } = await supabase
      .from('brand_submissions')
      .insert({
        id: retryTargetId,
        brand_name: retryBrandName,
        submitter_email: 'e2e-retry-phase@test.example',
        status: 'pending',
        intent: 'recommend',
      });
    if (retrySubmissionError) {
      throw new Error(`retry submission seed failed: ${retrySubmissionError.message}`);
    }

    const { data: retryId, error: retryEnqueueError } = await supabase.rpc('enqueue_curation_job', {
      p_operation: 'enrich',
      p_params: { target: 'submissions', submissionIds: [retryTargetId] },
      p_dry_run: false,
      p_started_by: 'e2e-retry-phase',
      p_trigger: 'admin',
      p_parent_job_id: null,
      p_attempt: 1,
      p_scheduled_for: null,
      p_run_after: '2099-01-01T00:00:00.000Z',
      p_dedupe_key: `e2e-retry-phase:${randomUUID()}`,
      p_targets: [
        {
          target_type: 'submission',
          target_id: retryTargetId,
          brand_name: retryBrandName,
          brand_slug: retryBrandSlug,
        },
      ],
    });
    if (retryEnqueueError || !retryId) {
      throw new Error(`retry job seed failed: ${retryEnqueueError?.message ?? 'missing job id'}`);
    }
    retryJobId = retryId;

    const retryCompletedAt = new Date().toISOString();
    const retryStartedAt = new Date(Date.now() - 2_000).toISOString();
    const { error: retryTargetError } = await supabase
      .from('curation_job_targets')
      .update({
        status: 'failed',
        current_phase: 'faq',
        phase_results: [
          { phase: 'descriptions', status: 'succeeded', changedFields: ['description'], durationMs: 800 },
          { phase: 'faq', status: 'failed', changedFields: [], durationMs: 1200, error: 'FAQ generation timed out' },
        ],
        changed_fields: ['description'],
        error: 'FAQ generation timed out',
        started_at: retryStartedAt,
        completed_at: retryCompletedAt,
        duration_ms: 2000,
      })
      .eq('job_id', retryJobId)
      .eq('target_id', retryTargetId);
    if (retryTargetError) {
      throw new Error(`retry target seed failed: ${retryTargetError.message}`);
    }

    const { error: retryJobError } = await supabase
      .from('curation_jobs')
      .update({
        status: 'completed',
        started_at: retryStartedAt,
        completed_at: retryCompletedAt,
        target_total: 1,
        succeeded_count: 0,
        skipped_count: 0,
        failed_count: 1,
        result: { success: 0, skipped: 0, failed: 1 },
      })
      .eq('id', retryJobId);
    if (retryJobError) {
      throw new Error(`retry job completion seed failed: ${retryJobError.message}`);
    }
  });

  test.afterAll(async () => {
    if (!supabase || !parentJobId) return;

    // Collect all child jobs from both parent and retry parent
    const parentIds = [parentJobId, retryJobId].filter(Boolean);
    const allChildJobs: { id: string }[] = [];
    for (const pid of parentIds) {
      const { data, error } = await supabase
        .from('curation_jobs')
        .select('id')
        .eq('parent_job_id', pid);
      if (error) {
        throw new Error(`[e2e-cleanup] child job lookup failed: ${error.message}`);
      }
      allChildJobs.push(...(data ?? []));
    }

    const childIds = Array.from(
      new Set([
        ...allChildJobs.map((job: { id: string }) => job.id),
        ...(childJobId ? [childJobId] : []),
        ...(retryChildJobId ? [retryChildJobId] : []),
      ]),
    );
    if (cancellableJobId) childIds.push(cancellableJobId);
    if (childIds.length > 0) {
      const { error: childDeleteError } = await supabase
        .from('curation_jobs')
        .delete()
        .in('id', childIds);
      if (childDeleteError) {
        throw new Error(`[e2e-cleanup] child job deletion failed: ${childDeleteError.message}`);
      }
    }

    // Delete parent jobs
    for (const pid of parentIds) {
      const { error } = await supabase
        .from('curation_jobs')
        .delete()
        .eq('id', pid);
      if (error) {
        throw new Error(`[e2e-cleanup] parent job deletion failed: ${error.message}`);
      }
    }

    // Delete submissions
    for (const sid of [targetId, retryTargetId].filter(Boolean)) {
      const { error } = await supabase
        .from('brand_submissions')
        .delete()
        .eq('id', sid);
      if (error) {
        throw new Error(`[e2e-cleanup] brand submission deletion failed: ${error.message}`);
      }
    }
  });

  test('admin sees one job log and cancels active work', async ({ adminPage }) => {
    test.setTimeout(BUDGET.TEST.ADMIN);
    test.skip(!cancellableJobId, 'cancellable job was not seeded');
    await adminPage.goto('/admin/jobs');
    const row = adminPage.locator('tbody tr').filter({ has: adminPage.locator(`a[href="/admin/jobs/${cancellableJobId}"]`) });
    await expect(row).toBeVisible({ timeout: BUDGET.NAVIGATION });
    await expect(row.locator('[data-slot="badge"]', { hasText: 'Queued' })).toBeVisible();
    await expect(adminPage.getByRole('columnheader', { name: 'Created' })).toBeVisible();
    await expect(adminPage.getByRole('columnheader', { name: 'Started' })).toBeVisible();
    await row.getByRole('button', { name: 'Cancel job' }).click();
    const dialog = adminPage.getByRole('alertdialog');
    await expect(dialog.getByRole('heading', { name: 'Cancel this job?' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel job' }).click();
    await expect(row.locator('[data-slot="badge"]', { hasText: 'Cancelled' })).toBeVisible({ timeout: BUDGET.GATED_UI });
  });

  test('admin reviews a failed curation target and manually reruns it', async ({ adminPage }) => {
    test.setTimeout(BUDGET.TEST.ADMIN);
    await adminPage.goto('/admin/jobs');
    await expect(adminPage.getByRole('heading', { name: 'Data Jobs' })).toBeVisible({ timeout: BUDGET.NAVIGATION });

    const historyLink = adminPage.locator(`a[href="/admin/jobs/${parentJobId}"]`);
    const historyRow = adminPage.locator('tbody tr').filter({ has: historyLink });
    await expect(async () => {
      await adminPage.reload({});
      await expect(historyLink).toHaveCount(1);
      await expect(historyRow).toBeVisible();
      await expect(historyRow).toContainText('Completed with failures');
      await expect(historyRow).toContainText('0 ok, 0 skipped, 1 failed');
    }).toPass(POLL.DB);

    await historyLink.click();
    await expect(adminPage).toHaveURL(new RegExp(`/admin/jobs/${parentJobId}$`), { timeout: BUDGET.NAVIGATION });
    await expect(adminPage.getByRole('heading', { name: 'Job Detail' })).toBeVisible({ timeout: BUDGET.NAVIGATION });
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
    await expect(targetRow).toContainText(phaseError);
    await expect(adminPage.getByText('What do phases mean?', { exact: true })).toBeVisible();

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
        POLL.NAVIGATION,
      )
      .toMatch(new RegExp(`^/admin/jobs/(?!${parentJobId}$)[^/]+$`));

    const childPath = new URL(adminPage.url()).pathname;
    childJobId = extractJobId(childPath);
    expect(childJobId).not.toBe(parentJobId);

    const childTargetRow = adminPage.locator('tbody tr').filter({ hasText: brandName });
    const parentLineageLink = adminPage.getByRole('link', {
      name: 'Previous job (attempt 1)',
      exact: true,
    });
    await expect(async () => {
      await adminPage.reload({});
      const childTriggerField = adminPage.getByText('Trigger', { exact: true }).locator('..');
      await expect(childTriggerField).toContainText('Rerun');
      await expect(childTargetRow).toBeVisible();
      await expect(childTargetRow).toContainText(brandName);
      await expect(parentLineageLink).toHaveAttribute('href', `/admin/jobs/${parentJobId}`);
    }).toPass(POLL.DB);

    const childDetailsToggle = childTargetRow.getByText('View details', { exact: true });
    await expect(childDetailsToggle).toHaveCount(1);
    await childDetailsToggle.click();
    await expect(childTargetRow.locator('details')).toContainText(brandSlug);
  });

  test('retries one phase for one target from the phase log', async ({ adminPage }) => {
    test.setTimeout(BUDGET.TEST.ADMIN);
    await adminPage.goto(`/admin/jobs/${retryJobId}`);
    await expect(adminPage.getByRole('heading', { name: 'Job Detail' })).toBeVisible({ timeout: BUDGET.NAVIGATION });

    const targetRow = adminPage.locator('tbody tr').filter({ hasText: retryBrandName });
    await expect(targetRow).toBeVisible();

    const detailsToggle = targetRow.getByText('View details', { exact: true });
    await detailsToggle.click();
    const details = targetRow.locator('details');
    await expect(details).toHaveAttribute('open', '');

    // Find the faq phase row and click Retry
    const faqPhaseItem = details.locator('li').filter({ hasText: 'faq' });
    await expect(faqPhaseItem).toBeVisible();
    const retryButton = faqPhaseItem.getByRole('button', { name: 'Retry' });
    await expect(retryButton).toBeVisible();
    await retryButton.click();

    // Choose "This step only" from the dropdown menu
    const retryOnlyItem = adminPage.getByRole('menuitem', { name: 'This step only' });
    await expect(retryOnlyItem).toBeVisible({ timeout: BUDGET.INTERACTIVE });
    await retryOnlyItem.click();

    // Wait for navigation to the child retry job
    await expect
      .poll(
        () => new URL(adminPage.url()).pathname,
        POLL.NAVIGATION,
      )
      .toMatch(new RegExp(`^/admin/jobs/(?!${retryJobId}$)[^/]+$`));

    const retryPath = new URL(adminPage.url()).pathname;
    retryChildJobId = extractJobId(retryPath);
    expect(retryChildJobId).not.toBe(retryJobId);

    // Verify trigger label, lineage, and DB params
    await expect(async () => {
      await adminPage.reload({});
      const triggerField = adminPage.getByText('Trigger', { exact: true }).locator('..');
      await expect(triggerField).toContainText('Retry faq (only)');
      const lineageLink = adminPage.getByRole('link', {
        name: 'Previous job (attempt 1)',
        exact: true,
      });
      await expect(lineageLink).toHaveAttribute('href', `/admin/jobs/${retryJobId}`);
    }).toPass(POLL.DB);

    // Verify the stored retry params in the database
    const retryJob = assertQueryOk(
      await supabase
        .from('curation_jobs')
        .select('params')
        .eq('id', retryChildJobId)
        .single(),
      'retry job lookup',
    );
    const params = retryJob.params as { retry?: unknown };
    expect(params.retry).toEqual({
      version: 1,
      action: { kind: 'phase', block: 'editorial', mode: 'only', subPhase: 'faq' },
      targets: { [retryTargetId]: { selected: ['faq'], forced: ['faq'], explicit: ['faq'] } },
    });
  });
});
