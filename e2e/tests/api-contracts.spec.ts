import { test, expect } from '../fixtures/auth'
import type { APIResponse } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { load } from 'cheerio'
import assert from 'node:assert/strict'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>

type GetContract = {
  status: number
  assertResponse: (response: APIResponse) => Promise<void>
}

const NEWSLETTER_CONFIRM_CONTRACT: GetContract = {
  status: 307,
  assertResponse: async (response) => {
    expect(response.headers()['location'] ?? '').toContain('subscribed=true')
  },
}
const VALID_UNSUBSCRIBE_CONTRACT: GetContract = {
  status: 200,
  assertResponse: async (response) => {
    expect(load(await response.text())('h1').text()).toBe('已取消訂閱')
  },
}
const MISSING_TOKEN_CONTRACT: GetContract = {
  status: 400,
  assertResponse: async (response) => {
    expect(load(await response.text())('h1').text()).toBe('連結不完整')
  },
}

/**
 * API Contracts
 *
 * Journey: Verifies that key API routes return the expected shapes, status
 * codes, and redirect behaviours.  Uses Playwright's request fixture — no
 * browser page involved.
 *
 * Actor: deep-suite request with no user authentication. On canonical staging,
 * the project-level capability cookie reaches the production route behavior.
 * Seeds: two owned newsletter rows + one fresh isolated user preference
 * Cleanup: exact-owned newsletter/preference rows; isolated user fixture cleans Auth
 *
 * Note: confirm precedes unsubscribe; already completed unsubscribe stays idempotent.
 * CI retry fragility: the confirm/unsubscribe tests use retries: 0 to prevent
 * mutating serial fixture setup during retries.
 */
test.describe('API — health + search', () => {
  let supabase: AnySupabaseClient | undefined
  // A brand seeded by this spec, so the search contract below is exercised
  // against a guaranteed hit instead of whatever `q=test` happens to match.
  // Search is deliberately not wrapped in excludeTestBrands (brands.ts), which
  // is what lets an [E2E-TEST] row serve as the probe here.
  let searchProbeQuery: string
  let searchProbeBrandId: string | undefined

  test.beforeAll(async ({ request }) => {
    // PREVIEW_MODE guard
    const probe = await request.get('/brands')
    if (probe.status() === 503) return

    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    const suffix = randomUUID().replaceAll('-', '').slice(0, 10)
    searchProbeQuery = `apicontract${suffix}`
    const { data, error } = await supabase
      .from('brands')
      .insert({
        name: `[E2E-TEST] ${searchProbeQuery}`,
        slug: `e2e-api-contract-${suffix}`,
        status: 'approved',
        approved_at: new Date().toISOString(),
        category: 'home',
        description: `[E2E-TEST] API contract search probe ${suffix}.`,
        is_demo: false,
      })
      .select('id')
      .single()
    if (error || !data) {
      throw new Error(`API contract seed failed: ${error?.message ?? 'no row'}`)
    }
    searchProbeBrandId = data.id as string
  })

  test.afterAll(async () => {
    if (!supabase || !searchProbeBrandId) return
    const { error } = await supabase.from('brands').delete().eq('id', searchProbeBrandId)
    if (error) throw new Error(`[e2e-cleanup] api contract brand cleanup failed: ${error.message}`)
  })

  test('GET /api/health returns ok', async ({ request }) => {
    if (!supabase) { test.skip(true, 'PREVIEW_MODE active'); return }

    const resp = await request.get('/api/health')
    expect(resp.status()).toBe(200)
    const body = await resp.json()
    expect(body).toMatchObject({ status: 'ok' })
    // The limiter's breaker state lives in the proxy's isolate and reaches this
    // route only as a header proxy() stamps. Unit tests can feed that header by
    // hand; only a real request proves the seam is wired end to end.
    expect(body.rateLimitStore).toBe('ok')
  })

  test('GET /api/search with query returns results shape', async ({ request }) => {
    if (!supabase) { test.skip(true, 'PREVIEW_MODE active'); return }

    const resp = await request.get(`/api/search?q=${searchProbeQuery}`)
    expect(resp.status()).toBe(200)
    const body = await resp.json()
    expect(body).toHaveProperty('results')
    expect(Array.isArray(body.results)).toBe(true)
    // Unconditional: the query is the spec's own seeded brand, so an empty
    // result is a failure. The shape check used to sit behind `if (length > 0)`,
    // which reduced the whole contract to a 200 plus Array.isArray.
    expect(body.results.length).toBeGreaterThan(0)
    const first = body.results[0]
    expect(first).toHaveProperty('id')
    expect(first).toHaveProperty('slug')
    expect(first).toHaveProperty('name')
    expect(first).toHaveProperty('categoryLabel')
  })

  test('GET /api/search without query returns 400', async ({ request }) => {
    if (!supabase) { test.skip(true, 'PREVIEW_MODE active'); return }

    const resp = await request.get('/api/search')
    expect(resp.status()).toBe(400)
    const body = await resp.json()
    expect(body).toHaveProperty('error')
    expect(typeof body.error).toBe('string')
  })
})

const CANARY_NO_SECRET_CONTRACT: GetContract = {
  status: 401,
  assertResponse: async (response) => {
    const body = await response.json()
    expect(body).toHaveProperty('error')
  },
}

test.describe('API — internal canary', () => {
  test('POST /api/internal/sentry-canary without the secret returns 401', async ({ request }) => {
    const resp = await request.post('/api/internal/sentry-canary', {
      data: { token: 'e2e-probe' },
    })
    expect(resp.status()).toBe(CANARY_NO_SECRET_CONTRACT.status)
    await CANARY_NO_SECRET_CONTRACT.assertResponse(resp)
  })
})

// --- Newsletter subscribe / unsubscribe ---
// Keep owned mutations serial and do not reinitialize the fixtures on retry.
// serial — fullyParallel:true causes multiple workers to run beforeAll
// simultaneously; each run instead owns a fresh user and distinct tokens.
test.describe.serial("API — newsletter", () => {
  test.describe.configure({ retries: 0 });

  let supabase: AnySupabaseClient | undefined;
  let testUserId: string | undefined;
  let confirmToken: string;
  let newsletterUnsubToken: string;
  let ownerUnsubToken: string;
  let englishConfirmToken: string;
  const ownedEmails: string[] = [];

  test.beforeAll(async ({ request, isolatedUser }) => {
    // PREVIEW_MODE guard
    const probe = await request.get("/brands");
    if (probe.status() === 503) return;

    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    const suffix = randomUUID();
    const testEmail = `e2e-api-contract-${suffix}@example.test`;
    const englishEmail = `e2e-api-contract-en-${suffix}@example.test`;
    ownedEmails.push(testEmail, englishEmail);
    ownerUnsubToken = randomUUID();
    testUserId = isolatedUser.id;

    // Seed newsletter subscriber
    confirmToken = randomUUID();
    englishConfirmToken = randomUUID();
    newsletterUnsubToken = randomUUID();

    const { error: nsError } = await supabase
      .from("newsletter_subscribers")
      .insert([
        {
          email: testEmail,
          interests: ["new-brands"],
          locale: "zh-TW",
          confirmed_at: null,
          confirm_token: confirmToken,
          unsubscribe_token: newsletterUnsubToken,
        },
        {
          email: englishEmail,
          interests: ["brand-stories"],
          locale: "en",
          confirmed_at: null,
          confirm_token: englishConfirmToken,
          unsubscribe_token: randomUUID(),
        },
      ]);
    if (nsError) throw new Error(`newsletter seed failed: ${nsError.message}`);

    // Seed owner_email_preferences
    if (testUserId) {
      const { error: oepError } = await supabase
        .from("owner_email_preferences")
        .insert({
          user_id: testUserId,
          unsubscribe_token: ownerUnsubToken,
          lifecycle_opted_in_at: new Date().toISOString(),
        });
      if (oepError)
        throw new Error(
          `owner_email_preferences seed failed: ${oepError.message}`,
        );
    }
  });

  test.afterAll(async () => {
    if (!supabase) return;
    const { error: newsletterError } = await supabase
      .from("newsletter_subscribers")
      .delete()
      .in("email", ownedEmails);
    if (newsletterError)
      throw new Error(
        `[e2e-cleanup] newsletter deletion failed: ${newsletterError.message}`,
      );
    const remaining = await supabase
      .from("newsletter_subscribers")
      .select("id")
      .in("email", ownedEmails);
    expect(remaining.error).toBeNull();
    expect(remaining.data).toEqual([]);
    if (testUserId) {
      const { error } = await supabase
        .from("owner_email_preferences")
        .delete()
        .eq("user_id", testUserId);
      if (error)
        throw new Error(
          `[e2e-cleanup] owner preference deletion failed: ${error.message}`,
        );
      const remainingOwner = await supabase
        .from("owner_email_preferences")
        .select("user_id")
        .eq("user_id", testUserId);
      expect(remainingOwner.error).toBeNull();
      expect(remainingOwner.data).toEqual([]);
    }
  });

  // --- Order matters: confirm before unsubscribe ---

  test("GET /api/newsletter/confirm redirects after a valid token", async ({
    request,
  }) => {
    if (!supabase) {
      test.skip(true, "PREVIEW_MODE active");
      return;
    }

    const resp = await request.get(
      `/api/newsletter/confirm?token=${confirmToken}`,
      { maxRedirects: 0 },
    );
    expect(resp.status()).toBe(NEWSLETTER_CONFIRM_CONTRACT.status);
    await NEWSLETTER_CONFIRM_CONTRACT.assertResponse(resp);
    const { data, error } = await supabase!
      .from("newsletter_subscribers")
      .select("confirmed_at")
      .eq("confirm_token", confirmToken)
      .single();
    expect(error).toBeNull();
    assert(data, "The owned preference must exist");
    expect(data.confirmed_at).not.toBeNull();
  });

  test("an English subscriber confirms and returns to the English homepage", async ({
    request,
  }) => {
    for (const query of ["", "&locale=en"]) {
      const response = await request.get(
        `/api/newsletter/confirm?token=${englishConfirmToken}${query}`,
        { maxRedirects: 0 },
      );
      expect(response.status()).toBe(307);
      expect(new URL(response.headers()["location"]).pathname).toBe("/en");
      expect(response.headers()["cache-control"]).toContain("no-store");
      expect(response.headers()["referrer-policy"]).toBe("no-referrer");
    }
    const confirmed = await supabase!
      .from("newsletter_subscribers")
      .select("confirmed_at")
      .eq("confirm_token", englishConfirmToken)
      .single();
    expect(confirmed.error).toBeNull();
    assert(confirmed.data, "The owned English preference must exist");
    expect(confirmed.data.confirmed_at).not.toBeNull();
  });

  test("GET /api/newsletter/unsubscribe accepts a valid token", async ({
    request,
  }) => {
    if (!supabase) {
      test.skip(true, "PREVIEW_MODE active");
      return;
    }

    const resp = await request.get(
      `/api/newsletter/unsubscribe?token=${newsletterUnsubToken}`,
    );
    expect(resp.status()).toBe(VALID_UNSUBSCRIBE_CONTRACT.status);
    await VALID_UNSUBSCRIBE_CONTRACT.assertResponse(resp);
    const { data, error } = await supabase!
      .from("newsletter_subscribers")
      .select("unsubscribed_at")
      .eq("unsubscribe_token", newsletterUnsubToken)
      .single();
    expect(error).toBeNull();
    assert(data, "The owned preference must exist");
    expect(data.unsubscribed_at).not.toBeNull();
  });

  test("GET /api/newsletter/unsubscribe rejects a missing token", async ({
    request,
  }) => {
    if (!supabase) {
      test.skip(true, "PREVIEW_MODE active");
      return;
    }

    const resp = await request.get("/api/newsletter/unsubscribe");
    expect(resp.status()).toBe(MISSING_TOKEN_CONTRACT.status);
    await MISSING_TOKEN_CONTRACT.assertResponse(resp);
  });

  test("GET /api/email/unsubscribe accepts a valid token", async ({
    request,
  }) => {
    test.skip(!supabase || !testUserId, "PREVIEW_MODE active or no test user");

    const resp = await request.get(
      `/api/email/unsubscribe?token=${ownerUnsubToken}`,
    );
    expect(resp.status()).toBe(VALID_UNSUBSCRIBE_CONTRACT.status);
    await VALID_UNSUBSCRIBE_CONTRACT.assertResponse(resp);
    const { data, error } = await supabase!
      .from("owner_email_preferences")
      .select("unsubscribed_at,lifecycle_opted_in_at")
      .eq("user_id", testUserId!)
      .single();
    expect(error).toBeNull();
    assert(data, "The owned preference must exist");
    expect(data.unsubscribed_at).not.toBeNull();
    expect(data.lifecycle_opted_in_at).toBeNull();
  });

  test("GET /api/email/unsubscribe rejects a missing token", async ({
    request,
  }) => {
    if (!supabase) {
      test.skip(true, "PREVIEW_MODE active");
      return;
    }

    const resp = await request.get("/api/email/unsubscribe");
    expect(resp.status()).toBe(MISSING_TOKEN_CONTRACT.status);
    await MISSING_TOKEN_CONTRACT.assertResponse(resp);
  });

  test("missing and invalid email links explain recovery in both languages without exposing tokens", async ({
    request,
  }) => {
    // 12 GETs in a burst exceed the Cloudflare /api/* rate limit (10 requests
    // per 10 s per IP, 10 s block). Request 11 and the next tests' /api calls
    // then get Cloudflare's 429. One request per 2 s leaves half of the
    // budget to the surrounding tests. Change the spacing if that rule changes.
    test.setTimeout(60_000);
    const token = randomUUID();
    for (const endpoint of [
      "/api/newsletter/confirm",
      "/api/newsletter/unsubscribe",
      "/api/email/unsubscribe",
    ]) {
      for (const locale of ["zh-TW", "en"]) {
        for (const hasToken of [false, true]) {
          const response = await request.get(
            `${endpoint}?locale=${locale}${hasToken ? `&token=${token}` : ""}`,
          );
          expect(response.status()).toBe(
            hasToken && !endpoint.endsWith("/confirm") ? 404 : 400,
          );
          const html = await response.text();
          const $ = load(html);
          expect($("html").attr("lang")).toBe(locale);
          expect($("h1").text()).toBe(
            hasToken
              ? locale === "en"
                ? "This link is no longer valid"
                : "連結已失效"
              : locale === "en"
                ? "This link is incomplete"
                : "連結不完整",
          );
          expect($("main a[href]")).toHaveLength(1);
          expect($("main a").attr("href")).toBe(locale === "en" ? "/en" : "/");
          expect(html).not.toContain(token);
          expect(response.headers()["cache-control"]).toContain("no-store");
          expect(response.headers()["referrer-policy"]).toBe("no-referrer");
          await new Promise((resolve) => setTimeout(resolve, 2_000));
        }
      }
    }
  });

  test("one-click POST unsubscribes remain successful without rewriting an already completed preference", async ({
    request,
  }) => {
    for (const [endpoint, table, token] of [
      [
        "/api/newsletter/unsubscribe",
        "newsletter_subscribers",
        newsletterUnsubToken,
      ],
      ["/api/email/unsubscribe", "owner_email_preferences", ownerUnsubToken],
    ]) {
      const before = await supabase!
        .from(table)
        .select("unsubscribed_at")
        .eq("unsubscribe_token", token)
        .single();
      expect(before.error).toBeNull();
      assert(before.data, "The owned preference must exist before retry");
      expect(before.data.unsubscribed_at).not.toBeNull();
      const response = await request.post(
        `${endpoint}?token=${token}&locale=en`,
        { form: { "List-Unsubscribe": "One-Click" } },
      );
      expect(response.status()).toBe(200);
      expect(load(await response.text())("h1").text()).toBe("Unsubscribed");
      const after = await supabase!
        .from(table)
        .select("unsubscribed_at")
        .eq("unsubscribe_token", token)
        .single();
      expect(after.error).toBeNull();
      assert(after.data, "The owned preference must exist after retry");
      expect(after.data.unsubscribed_at).toBe(before.data.unsubscribed_at);
    }
  });
});
