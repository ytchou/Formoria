import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>

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

  test.beforeAll(async ({ request }) => {
    // PREVIEW_MODE guard
    const probe = await request.get('/brands')
    if (probe.status() === 503) return

    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  })

  test('GET /api/health returns ok', async ({ request }) => {
    if (!supabase) { test.skip(true, 'PREVIEW_MODE active'); return }

    const resp = await request.get('/api/health')
    expect(resp.status()).toBe(200)
    const body = await resp.json()
    expect(body).toMatchObject({ status: 'ok' })
  })

  test('GET /api/search with query returns results shape', async ({ request }) => {
    if (!supabase) { test.skip(true, 'PREVIEW_MODE active'); return }

    const resp = await request.get('/api/search?q=test')
    expect(resp.status()).toBe(200)
    const body = await resp.json()
    expect(body).toHaveProperty('results')
    expect(Array.isArray(body.results)).toBe(true)
    // Shape check on any result that comes back
    if (body.results.length > 0) {
      const first = body.results[0]
      expect(first).toHaveProperty('id')
      expect(first).toHaveProperty('slug')
      expect(first).toHaveProperty('name')
      expect(first).toHaveProperty('category')
    }
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
    const testEmail = `e2e-api-contract-${wi}@test.formoria.com`
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

  test('GET /api/newsletter/confirm with valid token redirects to /?subscribed=true', async ({ request }) => {
    if (!supabase) { test.skip(true, 'PREVIEW_MODE active'); return }

    const resp = await request.get(
      `/api/newsletter/confirm?token=${confirmToken}`,
      { maxRedirects: 0 },
    )
    expect(resp.status()).toBe(307)
    const location = resp.headers()['location'] ?? ''
    expect(location).toContain('subscribed=true')
  })

  test('GET /api/newsletter/unsubscribe with valid token succeeds', async ({ request }) => {
    if (!supabase) { test.skip(true, 'PREVIEW_MODE active'); return }

    const resp = await request.get(
      `/api/newsletter/unsubscribe?token=${newsletterUnsubToken}`,
    )
    expect(resp.status()).toBe(200)
    const text = await resp.text()
    expect(text.toLowerCase()).toContain('unsubscribed')
  })

  test('GET /api/newsletter/unsubscribe without token returns 400', async ({ request }) => {
    if (!supabase) { test.skip(true, 'PREVIEW_MODE active'); return }

    const resp = await request.get('/api/newsletter/unsubscribe')
    expect(resp.status()).toBe(400)
    const text = await resp.text()
    expect(text).toContain('Missing')
  })

  test('GET /api/email/unsubscribe with valid token succeeds', async ({ request }) => {
    if (!supabase || !testUserId) { test.skip(true, 'PREVIEW_MODE active or no test user'); return }

    const resp = await request.get(
      `/api/email/unsubscribe?token=${ownerUnsubToken}`,
    )
    expect(resp.status()).toBe(200)
    const text = await resp.text()
    // The route returns "You have been unsubscribed from Formoria lifecycle emails…"
    expect(text.toLowerCase()).toContain('unsubscribed')
  })

  test('GET /api/email/unsubscribe without token returns 400', async ({ request }) => {
    if (!supabase) { test.skip(true, 'PREVIEW_MODE active'); return }

    const resp = await request.get('/api/email/unsubscribe')
    expect(resp.status()).toBe(400)
    const text = await resp.text()
    expect(text).toContain('Missing')
  })
})
