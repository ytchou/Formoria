import { createClient } from '@supabase/supabase-js';

// Dedicated namespace for accounts created through the *public* signUp endpoint.
//
// The admin API (auth.admin.createUser) accepts @test.local, which is why the
// isolatedUser fixture works with it. The public signUp endpoint does NOT: the
// cloud project rejects @test.local with HTTP 400 `Email address "…" is invalid`.
// A spec that treats that 400 as an acceptable outcome can never go red when
// signup actually breaks, so signup specs must use a domain the endpoint accepts.
export const SIGNUP_TEST_EMAIL_PREFIX = 'e2e-signup-';

// Supabase's public signUp endpoint rejects .local addresses (400 invalid);
// override per-environment if the project's email validator changes.
export const SIGNUP_TEST_EMAIL_DOMAIN = process.env.E2E_SIGNUP_EMAIL_DOMAIN ?? 'test.formoria.com';

export function signupTestEmail(purpose: string, workerIndex: number): string {
  return `${SIGNUP_TEST_EMAIL_PREFIX}${purpose}-${Date.now()}-${workerIndex}@${SIGNUP_TEST_EMAIL_DOMAIN}`;
}

// The Supabase email quota is PROJECT-WIDE, not per-address — every domain
// returns the same 429 once it trips. Namespacing does not dodge it, so specs
// need a discriminator to tell "infrastructure quota" (skip) from "signup is
// broken" (fail).
const EMAIL_RATE_LIMIT_PATTERN = /rate limit|429|too many requests/i;

export function isEmailRateLimitMessage(text: string | null | undefined): boolean {
  if (!text) return false;
  return EMAIL_RATE_LIMIT_PATTERN.test(text);
}

const LIST_USERS_PAGE_SIZE = 200;
// Bounded so a listUsers pagination bug cannot spin the cleanup forever.
const LIST_USERS_MAX_PAGES = 25;

/**
 * Deletes every auth user in the signup test namespace. Safe to call from
 * afterAll/globalTeardown: it never throws, and it sweeps users leaked by a
 * crashed run, not just the ones the current run created.
 */
export async function deleteSignupTestUsers(
  createdBefore?: string,
): Promise<number> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.warn('[e2e-cleanup] SUPABASE_SERVICE_ROLE_KEY not set — skipping signup user cleanup');
    return 0;
  }

  let deleted = 0;
  try {
    const supabase = createClient(url, key, { auth: { persistSession: false } });

    for (let page = 1; page <= LIST_USERS_MAX_PAGES; page += 1) {
      const { data, error } = await supabase.auth.admin.listUsers({
        page,
        perPage: LIST_USERS_PAGE_SIZE,
      });
      if (error) {
        console.warn('[e2e-cleanup] signup listUsers error:', error.message);
        break;
      }

      const users = data?.users ?? [];
      if (users.length === 0) break;

      for (const user of users) {
        if (!user.email?.startsWith(SIGNUP_TEST_EMAIL_PREFIX)) continue;
        if (createdBefore && user.created_at >= createdBefore) continue;
        const { error: deleteError } = await supabase.auth.admin.deleteUser(user.id);
        if (deleteError) {
          console.warn(
            `[e2e-cleanup] signup deleteUser error (${user.email}):`,
            deleteError.message,
          );
          continue;
        }
        deleted += 1;
      }

      if (users.length < LIST_USERS_PAGE_SIZE) break;
    }
  } catch (error) {
    console.warn(
      '[e2e-cleanup] signup user cleanup failed:',
      error instanceof Error ? error.message : String(error),
    );
    return deleted;
  }

  if (deleted > 0) {
    console.log(`[e2e-cleanup] deleted ${deleted} ${SIGNUP_TEST_EMAIL_PREFIX}* auth user(s)`);
  }
  return deleted;
}
