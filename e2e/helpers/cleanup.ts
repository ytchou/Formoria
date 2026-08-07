import { createClient } from '@supabase/supabase-js';
import { deleteSignupTestUsers } from './signup-namespace';

const ORPHAN_AGE_MS = 6 * 60 * 60 * 1_000;

export type CleanupOptions = {
  /**
   * ISO timestamp of this run's start. When set, the sweep targets rows created
   * AT OR AFTER it — the current run's own residue — instead of the 6h orphan
   * window. Teardown passes it so a crashed worker or a --grep-filtered run
   * stops leaving approved [E2E-TEST] brands live in the catalog; global-setup
   * must NOT, or one suite would delete a concurrently running suite's fixtures.
   *
   * Ceiling: a concurrent suite that started after this one still falls inside
   * the window. Upgrade path — stamp a run id into the seed names
   * (`[E2E-TEST] <runId> …`, which still matches the '[E2E-TEST]%' pattern the
   * public filter uses) and delete by run id, dropping the time heuristic.
   */
  createdSince?: string;
};

export async function cleanupTestData({ createdSince }: CleanupOptions = {}) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.warn('[e2e-cleanup] SUPABASE_SERVICE_ROLE_KEY not set, skipping cleanup');
    return;
  }

  const supabase = createClient(url, key);
  const orphanedBefore = new Date(Date.now() - ORPHAN_AGE_MS).toISOString();

  // Bounds the sweep to either this run's rows or previous runs' orphans.
  function withWindow<Q extends {
    gte(column: string, value: string): Q;
    lt(column: string, value: string): Q;
  }>(query: Q, column: string): Q {
    return createdSince
      ? query.gte(column, createdSince)
      : query.lt(column, orphanedBefore);
  }

  // brand_submissions.brand_id references brands(id) with no ON DELETE clause
  // (unlike the 13 other FKs to brands, which cascade), so submissions must go
  // first or the brands delete fails on a still-referencing row.
  const { error: subsErr } = await withWindow(
    supabase.from('brand_submissions').delete().like('brand_name', '[E2E-TEST]%'),
    'submitted_at',
  );

  const { error: brandsErr } = await withWindow(
    supabase.from('brands').delete().like('name', '[E2E-TEST]%'),
    'created_at',
  );

  const { error: newsletterErr } = await withWindow(
    supabase.from('newsletter_subscribers').delete().like('email', 'e2e-%'),
    'created_at',
  );

  const { data: usersData, error: usersErr } = await supabase.auth.admin.listUsers();
  const testUser = usersData?.users.find((user) => user.email === process.env.E2E_USER_EMAIL);
  const { error: ownerPrefsErr } = testUser
    ? await withWindow(
        supabase.from('owner_email_preferences').delete().eq('user_id', testUser.id),
        'created_at',
      )
    : { error: undefined };

  const failures = [
    subsErr && `brand_submissions: ${subsErr.message}`,
    brandsErr && `brands: ${brandsErr.message}`,
    newsletterErr && `newsletter_subscribers: ${newsletterErr.message}`,
    usersErr && `owner_email_preferences user lookup: ${usersErr.message}`,
    ownerPrefsErr && `owner_email_preferences: ${ownerPrefsErr.message}`,
  ].filter((entry): entry is string => typeof entry === 'string');

  if (!createdSince) {
    // Orphan sweep runs at global-setup, where throwing would abort the suite
    // over a transient delete error. Warn and let the run proceed.
    for (const failure of failures) {
      console.warn(`[e2e-cleanup] ${failure}`);
    }

    // Auth users created by the signup specs. Skipped in run-scoped mode: the
    // helper only takes a "created before" bound, so a run-scoped call would
    // sweep a concurrent suite's signup accounts too.
    await deleteSignupTestUsers(orphanedBefore);

    console.log(`[e2e-cleanup] swept [E2E-TEST] rows older than ${orphanedBefore}`);
    return;
  }

  console.log(`[e2e-cleanup] swept [E2E-TEST] rows created since ${createdSince}`);

  // Teardown must fail loudly: a silently warned error here is what let residue
  // accumulate while the sweep reported success.
  if (failures.length > 0) {
    throw new Error(`[e2e-cleanup] run-scoped sweep failed — ${failures.join('; ')}`);
  }
}
