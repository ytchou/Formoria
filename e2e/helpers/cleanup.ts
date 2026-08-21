import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  AUTH_TEST_EMAIL_PREFIXES,
  deleteNamespacedTestUsers,
  isNamespacedTestUser,
  normalizeEmail,
} from './signup-namespace';

const ORPHAN_AGE_MS = 6 * 60 * 60 * 1_000;

// Seed names opt into run-scoped cleanup by stamping this prefix + the run id
// right after the public '[E2E-TEST] ' marker, e.g. '[E2E-TEST] R-ab12cd34 …'.
// Kept here as the single source of truth so cleanup.ts's matcher and specs'
// name-builders can't drift apart. See e2eSeedName() below.
const RUN_STAMP_PREFIX = 'R-';
const E2E_NAME_PREFIXES = ['[E2E-TEST]', '[E2E-COMMUNITY]'] as const;

function isE2EName(value: unknown): boolean {
  return typeof value === 'string' && E2E_NAME_PREFIXES.some((prefix) => value.startsWith(prefix));
}

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
   * ISO timestamp of this run's start. Its presence marks strict teardown;
   * serialized staging invocations may sweep the complete E2E namespace,
   * while global-setup omits it and keeps the six-hour orphan window for safety
   * while a manual invocation is starting.
   */
  createdSince?: string;
};

type AnySupabaseClient = SupabaseClient;
type Row = Record<string, unknown>;
type Failure = string;
type AuthUser = NonNullable<Awaited<ReturnType<AnySupabaseClient["auth"]["admin"]["listUsers"]>>["data"]>["users"][number];

export const STORAGE_PAGE_SIZE = 1_000;
export const STORAGE_MAX_PAGES = 100;
export const DATABASE_PAGE_SIZE = 1_000;
export const DATABASE_MAX_PAGES = 100;

type PaginationOptions = {
  pageSize?: number;
  maxPages?: number;
};

export type StorageListEntry = {
  name: string;
  id?: string | null;
  metadata?: unknown;
};

export type StorageListPage = {
  data: StorageListEntry[] | null;
  error: { message: string } | null;
  nextOffset?: number;
};

/**
 * Storage's list endpoint is offset based. Keep paging in a pure helper so a
 * full page cannot accidentally hide objects after the first 1,000 entries,
 * and fail closed if a provider returns a non-progressing cursor.
 */
export async function paginateStorageList(
  listPage: (offset: number, limit: number) => Promise<StorageListPage>,
  { pageSize = STORAGE_PAGE_SIZE, maxPages = STORAGE_MAX_PAGES }: PaginationOptions = {},
): Promise<StorageListEntry[]> {
  validatePaginationOptions('storage', pageSize, maxPages);
  const entries: StorageListEntry[] = [];
  let offset = 0;
  const seenPageSignatures = new Set<string>();
  for (let page = 1; page <= maxPages; page += 1) {
    const result = await listPage(offset, pageSize);
    if (result.error) throw new Error(result.error.message);
    if (!Array.isArray(result.data)) {
      throw new Error(`storage list page ${page} was malformed`);
    }
    if (result.data.length > pageSize || result.data.some((entry) => !entry || typeof entry !== 'object' || typeof entry.name !== 'string')) {
      throw new Error(`storage list page ${page} was malformed`);
    }
    const nextOffset = result.nextOffset ?? offset + result.data.length;
    if (!Number.isInteger(nextOffset) || nextOffset < offset) {
      throw new Error(`storage list page ${page} had a malformed next offset`);
    }
    if (result.data.length === 0) {
      if (nextOffset !== offset) {
        throw new Error(`storage list page ${page} had a non-contiguous next offset`);
      }
      return entries;
    }
    const signature = result.data
      .map((entry) => `${entry.name}\u0000${entry.id ?? ""}`)
      .join("\u0001");
    if (seenPageSignatures.has(signature)) {
      throw new Error(`storage list page ${page} repeated a previous page`);
    }
    seenPageSignatures.add(signature);
    entries.push(...result.data);
    if (result.data.length < pageSize) {
      if (nextOffset !== offset + result.data.length) {
        throw new Error(`storage list page ${page} had a non-contiguous next offset`);
      }
      return entries;
    }
    if (nextOffset <= offset) {
      throw new Error(`storage list page ${page} did not advance its offset`);
    }
    if (nextOffset !== offset + result.data.length) {
      throw new Error(`storage list page ${page} had a non-contiguous next offset`);
    }
    if (page === maxPages) {
      throw new Error(
        `storage list pagination exceeded ${maxPages} pages`,
      );
    }
    offset = nextOffset;
  }
  return entries;
}

export type DatabaseListPage = {
  data: Row[] | null;
  error: { message: string } | null;
  nextOffset?: number;
};

function validatePaginationOptions(label: string, pageSize: number, maxPages: number): void {
  if (!Number.isInteger(pageSize) || pageSize <= 0) {
    throw new Error(`${label} pagination page size must be a positive integer`);
  }
  if (!Number.isInteger(maxPages) || maxPages <= 0) {
    throw new Error(`${label} pagination max pages must be a positive integer`);
  }
}

/**
 * PostgREST also uses offset ranges. Keep the discovery path bounded and
 * fail closed when a proxy/database response would make later rows invisible.
 */
export async function paginateDatabaseRows(
  listPage: (offset: number, limit: number) => Promise<DatabaseListPage>,
  { pageSize = DATABASE_PAGE_SIZE, maxPages = DATABASE_MAX_PAGES }: PaginationOptions = {},
): Promise<Row[]> {
  validatePaginationOptions('database', pageSize, maxPages);
  const rows: Row[] = [];
  const seenPageSignatures = new Set<string>();
  let offset = 0;
  for (let page = 1; page <= maxPages; page += 1) {
    const result = await listPage(offset, pageSize);
    if (result.error) throw new Error(result.error.message);
    if (!Array.isArray(result.data) || result.data.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) {
      throw new Error(`database list page ${page} was malformed`);
    }
    const nextOffset = result.nextOffset ?? offset + result.data.length;
    if (!Number.isInteger(nextOffset) || nextOffset < offset) {
      throw new Error(`database list page ${page} had a malformed next offset`);
    }
    if (result.data.length === 0) return rows;
    if (result.data.length > pageSize) {
      throw new Error(`database list page ${page} was malformed`);
    }
    const signature = JSON.stringify(result.data);
    if (seenPageSignatures.has(signature)) {
      throw new Error(`database list page ${page} repeated a previous page`);
    }
    seenPageSignatures.add(signature);
    rows.push(...result.data);
    if (result.data.length < pageSize) return rows;
    if (nextOffset <= offset) {
      throw new Error(`database list page ${page} did not advance its offset`);
    }
    if (nextOffset !== offset + result.data.length) {
      throw new Error(`database list page ${page} had a non-contiguous next offset`);
    }
    if (page === maxPages) {
      throw new Error(`database list pagination exceeded ${maxPages} pages`);
    }
    offset = nextOffset;
  }
  return rows;
}

async function listAllAuthUsers(
  supabase: AnySupabaseClient,
  failures: Failure[],
): Promise<AuthUser[]> {
  const users: AuthUser[] = [];
  const seenIds = new Set<string>();
  for (let page = 1; page <= 25; page += 1) {
    try {
      const { data, error } = await supabase.auth.admin.listUsers({
        page,
        perPage: STORAGE_PAGE_SIZE,
      });
      if (error) {
        failures.push(`auth users read: ${error.message}`);
        return users;
      }
      const pageUsers = data?.users ?? [];
      for (const user of pageUsers) {
        if (seenIds.has(user.id)) {
          failures.push(`auth users pagination repeated user ${user.id}`);
          return users;
        }
        seenIds.add(user.id);
        users.push(user);
      }
      if (pageUsers.length < STORAGE_PAGE_SIZE) return users;
      if (page === 25) {
        failures.push("auth users pagination exceeded 25 pages");
        return users;
      }
    } catch (error) {
      failures.push(`auth users read: ${error instanceof Error ? error.message : String(error)}`);
      return users;
    }
  }
  return users;
}

function isSweepCandidate(
  row: Row,
  createdSince: string | undefined,
  orphanedBefore: string,
): boolean {
  if (createdSince) return true;
  const createdAt = typeof row.created_at === 'string' ? row.created_at : null;
  return Boolean(createdAt && createdAt < orphanedBefore);
}

async function queryRows(
  supabase: AnySupabaseClient,
  table: string,
  columns: string,
  failures: Failure[],
): Promise<Row[]> {
  try {
    return await paginateDatabaseRows(async (offset, limit) => {
      const { data, error } = await supabase
        .from(table)
        .select(columns)
        .range(offset, offset + limit - 1);
      return {
        data: (data ?? null) as Row[] | null,
        error,
        nextOffset: offset + (data?.length ?? 0),
      };
    });
  } catch (error) {
    failures.push(`${table} read: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

async function deleteWhereIn(
  supabase: AnySupabaseClient,
  table: string,
  column: string,
  ids: readonly string[],
  failures: Failure[],
): Promise<void> {
  if (ids.length === 0) return;
  try {
    const { error } = await supabase.from(table).delete().in(column, [...new Set(ids)]);
    if (error) failures.push(`${table}: ${error.message}`);
  } catch (error) {
    failures.push(`${table}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function listStorageObjects(
  supabase: AnySupabaseClient,
  bucket: string,
  prefix: string,
  failures: Failure[],
): Promise<string[]> {
  try {
    const data = await paginateStorageList((offset, limit) =>
      supabase.storage.from(bucket).list(prefix, { limit, offset }),
    );
    const objects: string[] = [];
    for (const entry of data ?? []) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      // Supabase represents folders with a null id. Recurse so an orphaned
      // object cannot hide below a test namespace folder.
      if (!entry.id && !entry.metadata) {
        objects.push(...(await listStorageObjects(supabase, bucket, path, failures)));
      } else {
        objects.push(path);
      }
    }
    return objects;
  } catch (error) {
    failures.push(`${bucket}/${prefix} read: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

async function removeStorageObjects(
  supabase: AnySupabaseClient,
  bucket: string,
  paths: readonly string[],
  failures: Failure[],
): Promise<void> {
  const unique = [...new Set(paths.filter(Boolean))];
  if (unique.length === 0) return;
  try {
    const { error } = await supabase.storage.from(bucket).remove(unique);
    if (error) failures.push(`${bucket} remove: ${error.message}`);
  } catch (error) {
    failures.push(`${bucket} remove: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function cleanupTestData({ createdSince }: CleanupOptions = {}) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    if (createdSince) {
      throw new Error(
        '[e2e-cleanup] staging service role is required for run-scoped teardown',
      );
    }
    console.warn('[e2e-cleanup] SUPABASE_SERVICE_ROLE_KEY not set, skipping cleanup');
    return;
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } }) as AnySupabaseClient;
  const orphanedBefore = new Date(Date.now() - ORPHAN_AGE_MS).toISOString();

  // Complete deployed-staging invocations are serialized. The strict run
  // sweep therefore owns every E2E namespace, while the setup sweep only
  // removes rows older than the orphan window so an active run is untouched.
  const failures: Failure[] = [];
  const brands = (await queryRows(supabase, 'brands', 'id, name, slug, created_at', failures))
    .filter((row) =>
      isE2EName(row.name) &&
      isSweepCandidate(row, createdSince, orphanedBefore),
    );
  const brandIds = brands.map((row) => String(row.id)).filter(Boolean);
  const brandSlugs = brands.map((row) => String(row.slug ?? '')).filter(Boolean);
  const redirects = (await queryRows(
    supabase,
    'brand_slug_redirects',
    'old_slug, new_slug, created_at',
    failures,
  )).filter((row) =>
    (String(row.old_slug ?? '').startsWith('e2e-') || String(row.new_slug ?? '').startsWith('e2e-')) &&
    isSweepCandidate(row, createdSince, orphanedBefore),
  );
  const redirectOldSlugs = redirects.map((row) => String(row.old_slug ?? '')).filter(Boolean);
  const redirectNewSlugs = redirects.map((row) => String(row.new_slug ?? '')).filter(Boolean);
  const submissions = (await queryRows(
    supabase,
    'brand_submissions',
    'id, brand_id, brand_name, submitted_at',
    failures,
  )).filter((row) =>
    isE2EName(row.brand_name) &&
    (createdSince || isSweepCandidate({ created_at: row.submitted_at }, createdSince, orphanedBefore)),
  );
  const submissionIds = submissions.map((row) => String(row.id)).filter(Boolean);
  const events = (await queryRows(supabase, 'events', 'id, name, slug, created_at', failures)).filter((row) =>
    isE2EName(row.name) &&
    isSweepCandidate(row, createdSince, orphanedBefore),
  );
  const eventIds = events.map((row) => String(row.id)).filter(Boolean);
  const claims = brandIds.length
    ? await queryRows(supabase, 'claim_requests', 'id, brand_id, user_id, created_at, proof_url, proof_evidence', failures)
    : [];
  const claimRows = claims.filter((row) => brandIds.includes(String(row.brand_id)) && isSweepCandidate(row, createdSince, orphanedBefore));
  const claimIds = claimRows.map((row) => String(row.id)).filter(Boolean);
  const claimPrefixes = claimRows
    .filter((row) => row.user_id && row.brand_id)
    .map((row) => `${String(row.user_id)}/${String(row.brand_id)}`);

  // Capture storage paths before deleting rows. E2E uploads are always below
  // a submission, claim, or brand namespace; the known-prefix audit below
  // fails closed if an object remains after its row is gone.
  const brandImages = brandIds.length
    ? await queryRows(supabase, 'brand_images', 'storage_path, brand_id', failures)
    : [];
  const submissionImages = submissionIds.length
    ? await queryRows(supabase, 'submission_images', 'storage_path, submission_id', failures)
    : [];
  const originEvidence = brandIds.length
    ? await queryRows(supabase, 'origin_evidence', 'photo_paths, brand_id', failures)
    : [];
  const reports = (await queryRows(
    supabase,
    'brand_reports',
    'id, brand_id, notes, created_at',
    failures,
  )).filter((row) =>
    (brandIds.includes(String(row.brand_id)) || isE2EName(row.notes)) &&
    isSweepCandidate(row, createdSince, orphanedBefore),
  );
  const reportIds = reports.map((row) => String(row.id)).filter(Boolean);
  const brandImagePaths = brandImages
    .filter((row) => brandIds.includes(String(row.brand_id)))
    .map((row) => String(row.storage_path ?? ''));
  const submissionImagePaths = submissionImages
    .filter((row) => submissionIds.includes(String(row.submission_id)))
    .map((row) => String(row.storage_path ?? ''));
  const originEvidencePaths = originEvidence
    .filter((row) => brandIds.includes(String(row.brand_id)))
    .flatMap((row) => Array.isArray(row.photo_paths) ? row.photo_paths.map(String) : []);
  const storagePrefixes = {
    brandImages: [
      ...submissionIds.map((id) => `submissions/${id}`),
      ...brandIds.map((id) => `brands/${id}`),
    ],
    claimProofs: claimPrefixes,
    originEvidence: brandIds,
  };
  const storageObjects = {
    brandImages: (await Promise.all(storagePrefixes.brandImages.map((prefix) => listStorageObjects(supabase, 'brand-images', prefix, failures)))).flat(),
    claimProofs: (await Promise.all(storagePrefixes.claimProofs.map((prefix) => listStorageObjects(supabase, 'claim-proofs', prefix, failures)))).flat(),
    originEvidence: (await Promise.all(storagePrefixes.originEvidence.map((prefix) => listStorageObjects(supabase, 'origin-evidence', prefix, failures)))).flat(),
  };

  const jobs = (await queryRows(
    supabase,
    'curation_jobs',
    'id, started_by, dedupe_key, created_at',
    failures,
  )).filter((row) => {
    const startedBy = String(row.started_by ?? '');
    const dedupeKey = String(row.dedupe_key ?? '');
    return (startedBy.startsWith('e2e-') || startedBy.startsWith('[E2E-TEST]') || dedupeKey.startsWith('e2e-')) &&
      isSweepCandidate(row, createdSince, orphanedBefore);
  });
  const jobIds = jobs.map((row) => String(row.id)).filter(Boolean);
  const featureRequests = (await queryRows(supabase, 'feature_requests', 'id, title, created_at', failures)).filter((row) =>
    isE2EName(row.title) &&
    isSweepCandidate(row, createdSince, orphanedBefore),
  );
  const featureRequestIds = featureRequests.map((row) => String(row.id)).filter(Boolean);
  const newsletterRows = (await queryRows(supabase, 'newsletter_subscribers', 'id, email, created_at', failures)).filter((row) =>
    typeof row.email === 'string' &&
    row.email.startsWith('e2e-') &&
    isSweepCandidate(row, createdSince, orphanedBefore),
  );
  const newsletterIds = newsletterRows.map((row) => String(row.id)).filter(Boolean);
  const captureRows = (await queryRows(supabase, 'staging_auth_email_captures', 'id, recipient, created_at', failures)).filter((row) =>
    typeof row.recipient === 'string' &&
    isNamespacedTestUser(row.recipient, AUTH_TEST_EMAIL_PREFIXES) &&
    isSweepCandidate(row, createdSince, orphanedBefore),
  );
  const captureIds = captureRows.map((row) => String(row.id)).filter(Boolean);

  const allUsers = await listAllAuthUsers(supabase, failures);
  const disposableUsers = allUsers.filter((user) =>
    isNamespacedTestUser(user.email, AUTH_TEST_EMAIL_PREFIXES) &&
    (!createdSince && user.created_at ? user.created_at < orphanedBefore : true),
  );
  const durableEmails = [process.env.E2E_USER_EMAIL, process.env.E2E_ADMIN_EMAIL]
    .map(normalizeEmail)
    .filter(Boolean);
  const durableUsers = allUsers.filter((user) => durableEmails.includes(normalizeEmail(user.email)));
  const preferenceUserIds = [
    ...disposableUsers.map((user) => user.id),
    ...durableUsers.map((user) => user.id),
  ];

  // Delete children first. This includes the tables that were previously
  // omitted from the sweep (owner preferences, jobs, feature requests,
  // reports, images, and claim storage), then the namespaced roots.
  await deleteWhereIn(supabase, 'feature_request_votes', 'request_id', featureRequestIds, failures);
  await deleteWhereIn(supabase, 'curation_job_targets', 'job_id', jobIds, failures);
  await deleteWhereIn(supabase, 'curation_jobs', 'id', jobIds, failures);
  await deleteWhereIn(supabase, 'event_brands', 'event_id', eventIds, failures);
  await deleteWhereIn(supabase, 'events', 'id', eventIds, failures);
  await deleteWhereIn(supabase, 'feature_requests', 'id', featureRequestIds, failures);
  await deleteWhereIn(supabase, 'brand_reports', 'id', reportIds, failures);
  await deleteWhereIn(supabase, 'brand_field_corrections', 'brand_id', brandIds, failures);
  await deleteWhereIn(supabase, 'moderation_flags', 'brand_id', brandIds, failures);
  await deleteWhereIn(supabase, 'pending_brand_edits', 'brand_id', brandIds, failures);
  await deleteWhereIn(supabase, 'brand_saves', 'brand_id', brandIds, failures);
  await deleteWhereIn(supabase, 'brand_channels', 'brand_id', brandIds, failures);
  await deleteWhereIn(supabase, 'claim_proof_cleanup_jobs', 'claim_request_id', claimIds, failures);
  await deleteWhereIn(supabase, 'claim_requests', 'id', claimIds, failures);
  await deleteWhereIn(supabase, 'brand_owners', 'brand_id', brandIds, failures);
  await deleteWhereIn(supabase, 'origin_evidence', 'brand_id', brandIds, failures);
  await deleteWhereIn(supabase, 'brand_field_events', 'brand_id', brandIds, failures);
  await deleteWhereIn(supabase, 'brand_field_state', 'brand_id', brandIds, failures);
  await deleteWhereIn(supabase, 'brand_images', 'brand_id', brandIds, failures);
  await deleteWhereIn(supabase, 'brand_slug_redirects', 'old_slug', [...brandSlugs, ...redirectOldSlugs], failures);
  await deleteWhereIn(supabase, 'brand_slug_redirects', 'new_slug', [...brandSlugs, ...redirectNewSlugs], failures);
  await deleteWhereIn(supabase, 'submission_images', 'submission_id', submissionIds, failures);
  await deleteWhereIn(supabase, 'brand_ai_results', 'submission_id', submissionIds, failures);
  await deleteWhereIn(supabase, 'brand_search_results', 'submission_id', submissionIds, failures);
  await deleteWhereIn(supabase, 'brand_submissions', 'id', submissionIds, failures);
  await deleteWhereIn(supabase, 'brands', 'id', brandIds, failures);
  await deleteWhereIn(supabase, 'owner_email_preferences', 'user_id', preferenceUserIds, failures);
  await deleteWhereIn(supabase, 'newsletter_subscribers', 'id', newsletterIds, failures);
  await deleteWhereIn(supabase, 'staging_auth_email_captures', 'id', captureIds, failures);

  await removeStorageObjects(supabase, 'brand-images', [...brandImagePaths, ...submissionImagePaths, ...storageObjects.brandImages], failures);
  await removeStorageObjects(supabase, 'claim-proofs', storageObjects.claimProofs, failures);
  await removeStorageObjects(supabase, 'origin-evidence', [...originEvidencePaths, ...storageObjects.originEvidence], failures);

  if (!createdSince) {
    for (const failure of failures) console.warn(`[e2e-cleanup] ${failure}`);
    await deleteNamespacedTestUsers(AUTH_TEST_EMAIL_PREFIXES, orphanedBefore);
    console.log(`[e2e-cleanup] swept E2E namespaces older than ${orphanedBefore}`);
    return;
  }

  await deleteNamespacedTestUsers(AUTH_TEST_EMAIL_PREFIXES, undefined, { throwOnError: true });

  // Strict residue audit: every read, delete, and storage listing is an
  // integrity gate. A durable E2E account is never deleted, only its test
  // preferences are reset above.
  const residue: Failure[] = [];
  const countBy = async (label: string, query: PromiseLike<{ count: number | null; error: { message: string } | null }>) => {
    const result = await query;
    if (result.error) residue.push(`${label}: ${result.error.message}`);
    else if ((result.count ?? 0) > 0) residue.push(`${label}: ${result.count} row(s)`);
  };
  for (const prefix of E2E_NAME_PREFIXES) {
    await countBy(`brands ${prefix}`, supabase.from('brands').select('id', { count: 'exact', head: true }).like('name', `${prefix}%`));
    await countBy(`brand_submissions ${prefix}`, supabase.from('brand_submissions').select('id', { count: 'exact', head: true }).like('brand_name', `${prefix}%`));
    await countBy(`events ${prefix}`, supabase.from('events').select('id', { count: 'exact', head: true }).like('name', `${prefix}%`));
  }
  await countBy('owner_email_preferences', preferenceUserIds.length ? supabase.from('owner_email_preferences').select('user_id', { count: 'exact', head: true }).in('user_id', preferenceUserIds) : Promise.resolve({ count: 0, error: null }));
  await countBy('newsletter_subscribers', supabase.from('newsletter_subscribers').select('id', { count: 'exact', head: true }).like('email', 'e2e-%'));
  for (const prefix of AUTH_TEST_EMAIL_PREFIXES) {
    await countBy(`staging_auth_email_captures ${prefix}`, supabase.from('staging_auth_email_captures').select('id', { count: 'exact', head: true }).like('recipient', `${prefix}%`));
  }
  await countBy('brand_slug_redirects old_slug', supabase.from('brand_slug_redirects').select('old_slug', { count: 'exact', head: true }).like('old_slug', 'e2e-%'));
  await countBy('brand_slug_redirects new_slug', supabase.from('brand_slug_redirects').select('new_slug', { count: 'exact', head: true }).like('new_slug', 'e2e-%'));
  for (const [table, column, ids] of [
    ['curation_jobs', 'id', jobIds],
    ['curation_job_targets', 'job_id', jobIds],
    ['event_brands', 'event_id', eventIds],
    ['feature_requests', 'id', featureRequestIds],
    ['feature_request_votes', 'request_id', featureRequestIds],
    ['brand_reports', 'id', reportIds],
    ['brand_owners', 'brand_id', brandIds],
    ['brand_images', 'brand_id', brandIds],
    ['submission_images', 'submission_id', submissionIds],
    ['brand_ai_results', 'submission_id', submissionIds],
    ['brand_search_results', 'submission_id', submissionIds],
    ['brand_field_state', 'brand_id', brandIds],
    ['brand_field_events', 'brand_id', brandIds],
    ['brand_field_corrections', 'brand_id', brandIds],
    ['moderation_flags', 'brand_id', brandIds],
    ['pending_brand_edits', 'brand_id', brandIds],
    ['brand_saves', 'brand_id', brandIds],
    ['brand_channels', 'brand_id', brandIds],
    ['claim_requests', 'id', claimIds],
    ['claim_proof_cleanup_jobs', 'claim_request_id', claimIds],
    ['origin_evidence', 'brand_id', brandIds],
  ] as const) {
    await countBy(`${table}`, ids.length
      ? supabase.from(table).select('id', { count: 'exact', head: true }).in(column, ids)
      : Promise.resolve({ count: 0, error: null }));
  }
  for (const [bucket, prefixes] of [
    ['brand-images', storagePrefixes.brandImages],
    ['claim-proofs', storagePrefixes.claimProofs],
    ['origin-evidence', storagePrefixes.originEvidence],
  ] as const) {
    for (const prefix of prefixes) {
      const objects = await listStorageObjects(supabase, bucket, prefix, residue);
      if (objects.length > 0) residue.push(`${bucket}/${prefix}: ${objects.length} object(s)`);
    }
  }
  const remainingUsers = await listAllAuthUsers(supabase, residue);
  const remainingDisposable = remainingUsers.filter((user) => isNamespacedTestUser(user.email, AUTH_TEST_EMAIL_PREFIXES));
  if (remainingDisposable.length > 0) residue.push(`auth disposable users: ${remainingDisposable.length} user(s)`);

  if (failures.length > 0 || residue.length > 0) {
    throw new Error(`[e2e-cleanup] strict sweep failed — ${[...failures, ...residue].join('; ')}`);
  }
  console.log(`[e2e-cleanup] strict E2E namespace audit passed for run ${createdSince}`);
}
