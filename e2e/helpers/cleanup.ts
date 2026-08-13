import { createClient } from '@supabase/supabase-js';
import { deleteSignupTestUsers } from './signup-namespace';

const ORPHAN_AGE_MS = 6 * 60 * 60 * 1_000;

// Seed names opt into run-scoped cleanup by stamping this prefix + the run id
// right after the public '[E2E-TEST] ' marker, e.g. '[E2E-TEST] R-ab12cd34 …'.
// Kept here as the single source of truth so cleanup.ts's matcher and specs'
// name-builders can't drift apart. See e2eSeedName() below.
const RUN_STAMP_PREFIX = 'R-';

/**
 * Builds a `[E2E-TEST] …` seed name, stamping it with this run's id
 * (`E2E_RUN_ID`, set by global-setup) when one is available so the run-scoped
 * cleanup sweep below can target only this run's own rows. Falls back to the
 * plain '[E2E-TEST] <label>' shape if E2E_RUN_ID is unset (e.g. a spec run
 * outside the normal global-setup/teardown lifecycle).
 */
export function e2eSeedName(label: string): string {
  const runId = process.env.E2E_RUN_ID;
  return runId ? `[E2E-TEST] ${RUN_STAMP_PREFIX}${runId} ${label}` : `[E2E-TEST] ${label}`;
}

export type CleanupOptions = {
  /**
   * ISO timestamp of this run's start. Bounds the newsletter_subscribers and
   * owner_email_preferences sweeps — which have no run-id-stamped name to key
   * on — to rows created AT OR AFTER it, instead of the 6h orphan window.
   * Teardown passes it so a crashed worker or a --grep-filtered run stops
   * leaving that residue live; global-setup must NOT, or one suite would sweep
   * a concurrently running suite's still-in-progress fixtures.
   */
  createdSince?: string;
  /**
   * This run's short id (`E2E_RUN_ID`). When set alongside `createdSince`, the
   * brand_submissions/brands run-scoped sweep deletes only rows stamped with
   * THIS run's id (see e2eSeedName) instead of every '[E2E-TEST]%' row
   * submitted since createdSince — a concurrently running suite's still-live
   * fixtures on those two tables no longer fall inside another run's window.
   * Unstamped '[E2E-TEST]%' rows (specs that don't use e2eSeedName) are left
   * for the 6h orphan sweep instead of this run-scoped one.
   */
  runId?: string;
};

export async function cleanupTestData({ createdSince, runId }: CleanupOptions = {}) {
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

  // Run-scoped mode with a run id: match only rows THIS run stamped, so a
  // concurrently running suite's still-live '[E2E-TEST]%' rows on these two
  // tables survive. Otherwise (orphan sweep, or a caller with no run id): the
  // prior broad pattern + time-window bound.
  const brandPattern = createdSince && runId
    ? `[E2E-TEST] ${RUN_STAMP_PREFIX}${runId} %`
    : '[E2E-TEST]%';

  // brand_submissions.brand_id references brands(id) with no ON DELETE clause
  // (unlike the 13 other FKs to brands, which cascade), so submissions must go
  // first or the brands delete fails on a still-referencing row.
  const { error: subsErr } =
    createdSince && runId
      ? await supabase.from('brand_submissions').delete().like('brand_name', brandPattern)
      : await withWindow(
          supabase.from('brand_submissions').delete().like('brand_name', brandPattern),
          'submitted_at',
        );

  const { error: brandsErr } =
    createdSince && runId
      ? await supabase.from('brands').delete().like('name', brandPattern)
      : await withWindow(
          supabase.from('brands').delete().like('name', brandPattern),
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

  // Throw rather than warn: global-teardown's catch turns this into a
  // console.error, which is the loudest signal available without failing the
  // run. Ceiling: the run still exits 0, so a persistently failing sweep is
  // visible only to someone reading the log. Upgrade path — set
  // `process.exitCode = 1` in global-teardown once cleanup is reliable enough
  // that a failure means a real leak rather than a transient Supabase error.
  if (failures.length > 0) {
    throw new Error(`[e2e-cleanup] run-scoped sweep failed — ${failures.join('; ')}`);
  }
}
