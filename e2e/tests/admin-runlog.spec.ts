import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { test, expect } from '../fixtures/auth';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

test.describe('Admin run log', () => {
  test.beforeEach(() => {
    const adminEmail = process.env.E2E_ADMIN_EMAIL;
    const adminEmails = (process.env.ADMIN_EMAILS ?? '')
      .split(',')
      .map((email) => email.trim());
    test.skip(
      !adminEmail || !adminEmails.includes(adminEmail),
      'E2E_ADMIN_EMAIL not in ADMIN_EMAILS — admin tests require matching env',
    );
  });

  let supabase: AnySupabaseClient;
  let jobId: string | undefined;

  test.beforeAll(async () => {
    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    const { data, error } = await supabase.rpc('enqueue_curation_job', {
      p_operation: 'enrich',
      p_params: { target: 'brands', slugs: [] },
      p_dry_run: true,
      p_started_by: '[E2E-TEST] admin-runlog',
      p_trigger: 'admin',
      p_parent_job_id: null,
      p_attempt: 1,
      p_scheduled_for: null,
      p_run_after: '2099-01-01T00:00:00.000Z',
      p_dedupe_key: `e2e-admin-runlog:${randomUUID()}`,
      p_targets: [],
    });

    if (error || !data) {
      throw new Error(`curation job seed failed: ${error?.message ?? 'missing job id'}`);
    }
    jobId = data;
  });

  test.afterAll(async () => {
    if (!supabase || !jobId) return;

    const { error } = await supabase.from('curation_jobs').delete().eq('id', jobId);
    if (error) {
      console.warn(`[e2e-cleanup] run-log job deletion failed: ${error.message}`);
    }
  });

  test('serves HTML to an admin and redirects an anonymous visitor', async ({
    adminPage,
    anonPage,
  }) => {
    const adminResponse = await adminPage.request.get(`/admin/jobs/${jobId}/runlog`);

    expect(adminResponse.status()).toBe(200);
    expect(adminResponse.headers()['content-type']).toContain('text/html');
    expect(await adminResponse.text()).toContain(jobId);

    const anonymousResponse = await anonPage.request.get(`/admin/jobs/${jobId}/runlog`, {
      maxRedirects: 0,
    });

    expect(anonymousResponse.status()).toBe(307);
    expect(anonymousResponse.headers().location).toContain('/auth/sign-in');
  });
});
