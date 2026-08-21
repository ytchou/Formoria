import { test, expect, type APIResponse } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>

const IS_CANONICAL_STAGING_TARGET =
  new URL(
    process.env.BASE_URL ??
      process.env.PLAYWRIGHT_BASE_URL ??
      process.env.STAGING_BASE_URL ??
      'http://localhost:3000',
  ).origin === 'https://staging.formoria.com'

type StagingAwareGetContract = {
  status: number
  assertResponse: (response: APIResponse) => Promise<void>
}

function stagingAwareGetMutationContract(
  nonStagingStatus: number,
  assertNonStagingResponse: (response: APIResponse) => Promise<void>,
): StagingAwareGetContract {
  if (IS_CANONICAL_STAGING_TARGET) {
    return {
      status: 403,
      assertResponse: async (response) => {
        expect(await response.json()).toEqual({
          error: 'This flow is disabled in staging',
        })
      },
    }
  }

  return {
    status: nonStagingStatus,
    assertResponse: assertNonStagingResponse,
  }
}

const NEWSLETTER_CONFIRM_CONTRACT = stagingAwareGetMutationContract(
  307,
  async (response) => {
    expect(response.headers()['location'] ?? '').toContain('subscribed=true')
  },
)
const VALID_UNSUBSCRIBE_CONTRACT = stagingAwareGetMutationContract(
  200,
  async (response) => {
    expect((await response.text()).toLowerCase()).toContain('unsubscribed')
  },
)
const MISSING_TOKEN_CONTRACT = stagingAwareGetMutationContract(
  400,
  async (response) => {
    expect(await response.text()).toContain('Missing')
  },
)

/**
 * API Contracts
 *
 * Journey: Verifies that key API routes return the expected shapes, status
 * codes, and redirect behaviours.  Uses Playwright's request fixture — no
 * browser page involved.
 *
 * Actor: anonymous request (no auth headers)
 * Seeds: one newsletter_subscribers row + one owner_email_preferences row
 * Cleanup: afterAll deletes both rows
 *
 * Note: confirm→unsubscribe order matters — confirm consumes the token first.
 * CI retry fragility: the confirm/unsubscribe tests use retries: 0 to prevent
 * token re-use issues on retry.
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

// --- Newsletter subscribe / unsubscribe ---
// retries: 0 — confirm consumes the token; a retry would fail on re-use.
// serial — fullyParallel:true causes multiple workers to run beforeAll
// simultaneously, each deleting and re-inserting the owner_email_preferences
// row (UNIQUE on user_id), overwriting the other worker's token.
test.describe.serial('API — newsletter', () => {
  test.describe.configure({ retries: 0 })

  let supabase: AnySupabaseClient | undefined
  let testUserId: string | undefined
  let confirmToken: string
  let newsletterUnsubToken: string
  let ownerUnsubToken: string

  test.beforeAll(async ({ request }, workerInfo) => {
    // PREVIEW_MODE guard
    const probe = await request.get('/brands')
    if (probe.status() === 503) return

    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    const wi = workerInfo.workerIndex
    const testEmail = `e2e-api-contract-${wi}@example.test`
    ownerUnsubToken = randomUUID()

    // Resolve test user id
    const { data: usersData } = await supabase.auth.admin.listUsers()
    const testUser = usersData?.users?.find(
      (u) => u.email === process.env.E2E_USER_EMAIL,
    )
    if (testUser) testUserId = testUser.id

    // Pre-delete orphans to satisfy UNIQUE on email
    await supabase
      .from('newsletter_subscribers')
      .delete()
      .like('email', 'e2e-api-contract-%')

    // Pre-delete owner_email_preferences to satisfy PK on user_id
    if (testUserId) {
      await supabase
        .from('owner_email_preferences')
        .delete()
        .eq('user_id', testUserId)
    }

    // Seed newsletter subscriber
    confirmToken = randomUUID()
    newsletterUnsubToken = randomUUID()

    const { error: nsError } = await supabase
      .from('newsletter_subscribers')
      .insert({
        email: testEmail,
        interests: ['new-brands'],
        locale: 'zh-TW',
        confirmed_at: null,
        confirm_token: confirmToken,
        unsubscribe_token: newsletterUnsubToken,
      })
    if (nsError) throw new Error(`newsletter seed failed: ${nsError.message}`)

    // Seed owner_email_preferences
    if (testUserId) {
      const { error: oepError } = await supabase
        .from('owner_email_preferences')
        .insert({ user_id: testUserId, unsubscribe_token: ownerUnsubToken })
      if (oepError) throw new Error(`owner_email_preferences seed failed: ${oepError.message}`)
    }
  })

  test.afterAll(async () => {
    if (!supabase) return
    await supabase
      .from('newsletter_subscribers')
      .delete()
      .like('email', 'e2e-api-contract-%')
    if (testUserId) {
      await supabase
        .from('owner_email_preferences')
        .delete()
        .eq('user_id', testUserId)
    }
  })

  // --- Order matters: confirm before unsubscribe ---

  test('GET /api/newsletter/confirm honors the environment contract with a valid token', async ({ request }) => {
    if (!supabase) { test.skip(true, 'PREVIEW_MODE active'); return }

    const resp = await request.get(
      `/api/newsletter/confirm?token=${confirmToken}`,
      { maxRedirects: 0 },
    )
    expect(resp.status()).toBe(NEWSLETTER_CONFIRM_CONTRACT.status)
    await NEWSLETTER_CONFIRM_CONTRACT.assertResponse(resp)
  })

  test('GET /api/newsletter/unsubscribe honors the environment contract with a valid token', async ({ request }) => {
    if (!supabase) { test.skip(true, 'PREVIEW_MODE active'); return }

    const resp = await request.get(
      `/api/newsletter/unsubscribe?token=${newsletterUnsubToken}`,
    )
    expect(resp.status()).toBe(VALID_UNSUBSCRIBE_CONTRACT.status)
    await VALID_UNSUBSCRIBE_CONTRACT.assertResponse(resp)
  })

  test('GET /api/newsletter/unsubscribe honors the environment contract without a token', async ({ request }) => {
    if (!supabase) { test.skip(true, 'PREVIEW_MODE active'); return }

    const resp = await request.get('/api/newsletter/unsubscribe')
    expect(resp.status()).toBe(MISSING_TOKEN_CONTRACT.status)
    await MISSING_TOKEN_CONTRACT.assertResponse(resp)
  })

  test('GET /api/email/unsubscribe honors the environment contract with a valid token', async ({ request }) => {
    test.skip(
      !supabase || (!IS_CANONICAL_STAGING_TARGET && !testUserId),
      'PREVIEW_MODE active or no test user',
    )

    const resp = await request.get(
      `/api/email/unsubscribe?token=${ownerUnsubToken}`,
    )
    expect(resp.status()).toBe(VALID_UNSUBSCRIBE_CONTRACT.status)
    await VALID_UNSUBSCRIBE_CONTRACT.assertResponse(resp)
  })

  test('GET /api/email/unsubscribe honors the environment contract without a token', async ({ request }) => {
    if (!supabase) { test.skip(true, 'PREVIEW_MODE active'); return }

    const resp = await request.get('/api/email/unsubscribe')
    expect(resp.status()).toBe(MISSING_TOKEN_CONTRACT.status)
    await MISSING_TOKEN_CONTRACT.assertResponse(resp)
  })
})
