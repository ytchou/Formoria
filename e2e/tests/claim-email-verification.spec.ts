import { createHash } from 'node:crypto';
import { test, expect } from '../fixtures/auth';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

/**
 * Claim email-verify endpoint — negative paths.
 *
 * Route: GET /api/claim/verify-email?cr=<id>&i=<index>&token=<token>
 *
 * Case 1 (no seed): nonexistent cr UUID → redirects to "/" (no 5xx).
 * Case 2 (seeded):  valid cr row + wrong token → redirects to
 *   /<locale>/brands/<slug>?claim=verify_failed (no 5xx).
 *
 * Happy-path (correct token) and the "already verified" path are deferred:
 * they need the real plaintext token from the claim-creation flow.
 * TODO(catalog): happy-path + already-verified need a seeded token via createClaimRequest.
 */
test.describe('Claim email verification endpoint', () => {
  let supabase: AnySupabaseClient;
  let brandId: string;
  let brandSlug: string;
  let claimRequestId: string;

  test.beforeAll(async () => {
    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: usersData, error: usersError } =
      await supabase.auth.admin.listUsers();
    if (usersError) throw new Error(`Failed to list users: ${usersError.message}`);

    const testUser = usersData.users.find(
      (u) => u.email === process.env.E2E_USER_EMAIL
    );
    if (!testUser) {
      throw new Error(
        `E2E test user not found: ${process.env.E2E_USER_EMAIL}. Run global-setup first.`
      );
    }

    const ts = Date.now();
    brandSlug = `e2e-claim-verify-${ts}`;

    // Seed the brand (unclaimed so it can receive a claim request)
    const { data: brandData, error: brandErr } = await supabase
      .from('brands')
      .insert({
        name: `[E2E-TEST] Claim Verify ${ts}`,
        slug: brandSlug,
        status: 'approved',
        description: '[E2E-TEST] Claim verification test brand.',
        purchase_links: [],
        social_links: {},
        retail_locations: [],
        product_photos: [],
      })
      .select('id')
      .single();
    if (brandErr || !brandData) throw new Error(`Failed to seed brand: ${brandErr?.message}`);
    brandId = brandData.id;

    // Build a domain_email proof with a known tokenHash and a future expiry.
    // We store the hash of a "correct" token, but we will test with a "wrong" token.
    const correctToken = 'correct-token-placeholder-e2e';
    const tokenHash = createHash('sha256').update(correctToken).digest('hex');
    const tokenExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const proofEvidence = [
      {
        type: 'domain_email',
        email: testUser.email,
        tokenHash,
        tokenExpiresAt,
      },
    ];

    // Insert claim_requests row directly via service-role
    const { data: crData, error: crErr } = await supabase
      .from('claim_requests')
      .insert({
        user_id: testUser.id,
        brand_id: brandId,
        proof_evidence: proofEvidence,
      })
      .select('id')
      .single();
    if (crErr || !crData) throw new Error(`Failed to seed claim_request: ${crErr?.message}`);
    claimRequestId = crData.id;
  });

  test.afterAll(async () => {
    if (!supabase) return;
    if (claimRequestId) {
      await supabase.from('claim_requests').delete().eq('id', claimRequestId);
    }
    if (brandId) {
      await supabase.from('brand_owners').delete().eq('brand_id', brandId);
      await supabase.from('brands').delete().eq('id', brandId);
    }
  });

  test('nonexistent claim-request UUID redirects to / without 5xx', async ({ anonPage }) => {
    const nonExistentId = '00000000-0000-0000-0000-000000000000';
    const resp = await anonPage.goto(
      `/api/claim/verify-email?cr=${nonExistentId}&i=0&token=bogus`
    );

    // The endpoint must not return a 5xx status at any point in the redirect chain
    if (resp) {
      expect(resp.status()).toBeLessThan(500);
    }

    // Must end up at the root path (the no-match redirect target per the route).
    // Playwright's toHaveURL matches the FULL url (incl. origin), so assert on the
    // parsed pathname instead — allow a bare "/" or an optional locale root.
    await anonPage.waitForURL(
      (u) => {
        const p = new URL(u).pathname;
        return p === '/' || /^\/[a-z]{2}(-[A-Z]{2})?\/?$/.test(p);
      },
      { timeout: 10_000 }
    );
  });

  test('valid claim-request + wrong token redirects to brands/<slug>?claim=verify_failed', async ({ anonPage }) => {
    const resp = await anonPage.goto(
      `/api/claim/verify-email?cr=${claimRequestId}&i=0&token=definitely-wrong-token`
    );

    // No 5xx
    if (resp) {
      expect(resp.status()).toBeLessThan(500);
    }

    // Must redirect to a brand page with ?claim=verify_failed
    await anonPage.waitForURL(
      (u) => {
        const parsed = new URL(u);
        return (
          parsed.pathname.includes(brandSlug) &&
          parsed.searchParams.get('claim') === 'verify_failed'
        );
      },
      { timeout: 10_000 }
    );
  });
});
