import { createClient } from '@supabase/supabase-js';

// Dedicated namespace for accounts created through the *public* signUp endpoint.
//
// The admin API (auth.admin.createUser) accepts @test.local, which is why the
// isolatedUser fixture works with it. The public signUp endpoint does NOT: the
// cloud project rejects @test.local with HTTP 400 `Email address "…" is invalid`.
// A spec that treats that 400 as an acceptable outcome can never go red when
// signup actually breaks, so signup specs must use a domain the endpoint accepts.
export const SIGNUP_TEST_EMAIL_PREFIX = 'e2e-signup-';
export const ISOLATED_TEST_EMAIL_PREFIX = 'e2e-isolated-owner-';
// Every account created by an E2E journey through the admin API belongs to
// this list. Durable E2E_USER/E2E_ADMIN accounts are deliberately absent.
export const AUTH_TEST_EMAIL_PREFIXES = [
  SIGNUP_TEST_EMAIL_PREFIX,
  ISOLATED_TEST_EMAIL_PREFIX,
  'e2e-signout-',
  'e2e-mit-owner-',
  'public-boundary-',
] as const;

// Supabase's public signUp endpoint rejects .local addresses (400 invalid);
// override per-environment if the project's email validator changes. The
// staging Send Email Hook captures these messages before delivery, so the
// default reserved domain cannot accidentally receive external mail.
export const SIGNUP_TEST_EMAIL_DOMAIN = process.env.E2E_SIGNUP_EMAIL_DOMAIN ?? 'example.test';

export function signupTestEmail(purpose: string, workerIndex: number): string {
  return `${SIGNUP_TEST_EMAIL_PREFIX}${purpose}-${Date.now()}-${workerIndex}@${SIGNUP_TEST_EMAIL_DOMAIN}`;
}

const LIST_USERS_PAGE_SIZE = 200;
// Bounded so a listUsers pagination bug cannot spin the cleanup forever.
const LIST_USERS_MAX_PAGES = 25;
type DeleteTestUserOptions = { throwOnError?: boolean };

export function normalizeEmail(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/**
 * Returns true only for disposable auth users. Durable staging accounts are
 * protected by normalized email equality even when they happen to use one of
 * the disposable prefixes.
 */
export function isNamespacedTestUser(
  email: string | null | undefined,
  prefixes: readonly string[],
  protectedEmails: readonly (string | null | undefined)[] = [
    process.env.E2E_USER_EMAIL,
    process.env.E2E_ADMIN_EMAIL,
  ],
): boolean {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  const protectedSet = new Set(
    protectedEmails.map(normalizeEmail).filter(Boolean),
  );
  if (protectedSet.has(normalized)) return false;
  return prefixes.some((prefix) => normalized.startsWith(normalizeEmail(prefix)));
}

export async function deleteNamespacedTestUsers(
  prefixes: readonly string[],
  createdBefore?: string,
  options: DeleteTestUserOptions = {},
): Promise<number> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    if (options.throwOnError) {
      throw new Error('[e2e-cleanup] staging service role is required for auth cleanup');
    }
    console.warn('[e2e-cleanup] SUPABASE_SERVICE_ROLE_KEY not set — skipping auth user cleanup');
    return 0;
  }

  let deleted = 0;
  const failures: string[] = [];
  try {
    const supabase = createClient(url, key, { auth: { persistSession: false } });
    const candidates: Array<{ id: string; email: string }> = [];

    for (let page = 1; page <= LIST_USERS_MAX_PAGES; page += 1) {
      const { data, error } = await supabase.auth.admin.listUsers({
        page,
        perPage: LIST_USERS_PAGE_SIZE,
      });
      if (error) {
        failures.push(`listUsers: ${error.message}`);
        break;
      }

      const users = data?.users ?? [];
      if (users.length === 0) break;

      for (const user of users) {
        const email = user.email;
        if (typeof email !== 'string' || !isNamespacedTestUser(email, prefixes)) {
          continue;
        }
        if (createdBefore && user.created_at >= createdBefore) continue;
        candidates.push({ id: user.id, email });
      }

      if (users.length < LIST_USERS_PAGE_SIZE) break;
      if (page === LIST_USERS_MAX_PAGES) {
        failures.push(`listUsers pagination exceeded ${LIST_USERS_MAX_PAGES} pages`);
        break;
      }
    }

    // List all candidates before deleting: deleting while paging shifts later
    // users into earlier pages and can silently leave every other account.
    for (const candidate of candidates) {
      const { error: deleteError } = await supabase.auth.admin.deleteUser(candidate.id);
      if (deleteError) {
        failures.push(`${candidate.email}: ${deleteError.message}`);
        continue;
      }
      deleted += 1;
    }
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }

  if (failures.length > 0 && options.throwOnError) {
    throw new Error(`[e2e-cleanup] auth user cleanup failed — ${failures.join('; ')}`);
  }
  for (const failure of failures) {
    console.warn(`[e2e-cleanup] ${failure}`);
  }
  if (deleted > 0) {
    console.log(`[e2e-cleanup] deleted ${deleted} namespaced auth user(s)`);
  }
  return deleted;
}

/**
 * Deletes every auth user in the signup test namespace. The default is
 * best-effort for spec afterAll hooks; global teardown opts into throwing so a
 * persistent cleanup failure cannot certify a green run.
 */
/**
 * Whether a namespaced test account still exists.
 *
 * The cleanup invariant is "no signup account leaks", which is a statement about
 * ABSENCE. Counting how many rows a particular sweep deleted cannot express it:
 * the global `[e2e-cleanup]` sweep and every other worker delete the same
 * namespace, so a count of 0 usually means someone else got there first, not
 * that anything leaked.
 */
export async function namespacedTestUserExists(email: string): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('[e2e-cleanup] staging service role is required for auth cleanup');
  }
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const target = normalizeEmail(email);
  for (let page = 1; page <= LIST_USERS_MAX_PAGES; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: LIST_USERS_PAGE_SIZE,
    });
    if (error) throw error;
    if (data.users.some((user) => normalizeEmail(user.email) === target)) return true;
    if (data.users.length < LIST_USERS_PAGE_SIZE) return false;
  }
  return false;
}

export async function deleteSignupTestUsers(
  createdBefore?: string,
  options: DeleteTestUserOptions = {},
): Promise<number> {
  return deleteNamespacedTestUsers([SIGNUP_TEST_EMAIL_PREFIX], createdBefore, options);
}
