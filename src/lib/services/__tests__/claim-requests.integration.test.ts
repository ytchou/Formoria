import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'
import { createTestClient, describeWithDb } from '@/test/setup'

const mockedServerState = vi.hoisted(() => ({
  authClient: null as SupabaseClient | null,
}))

vi.mock('@/lib/supabase/server', async () => {
  const actual = await vi.importActual<typeof import('@/lib/supabase/server')>(
    '@/lib/supabase/server'
  )

  return {
    ...actual,
    createClient: vi.fn(async () => {
      if (!mockedServerState.authClient) {
        throw new Error('Authenticated test client has not been configured')
      }

      return mockedServerState.authClient
    }),
  }
})

import {
  approveClaimRequest,
  createClaimRequest,
  getClaimRequest,
  getClaimRequestById,
  rejectClaimRequest,
} from '../claim-requests'
import { getUserBrands } from '../brand-owners'

const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const BRAND_SLUG = `zzz-claim-request-itest-${RUN_ID}`
const USER_EMAIL = `claim-request-user-${RUN_ID}@example.com`
const REVIEWER_EMAIL = `claim-request-reviewer-${RUN_ID}@example.com`
const USER_PASSWORD = 'ClaimRequest123!'
const REVIEWER_PASSWORD = 'ClaimReview123!'

let brandId = ''
let userId = ''
let reviewerId = ''

describeWithDb('claim requests service (integration)', () => {
  beforeAll(async () => {
    const client = createTestClient()

    const { data: userResult, error: userError } = await client.auth.admin.createUser({
      email: USER_EMAIL,
      password: USER_PASSWORD,
      email_confirm: true,
    })
    if (userError || !userResult.user) {
      throw new Error(`Failed to create test user: ${userError?.message}`)
    }
    userId = userResult.user.id

    const { data: reviewerResult, error: reviewerError } = await client.auth.admin.createUser({
      email: REVIEWER_EMAIL,
      password: REVIEWER_PASSWORD,
      email_confirm: true,
    })
    if (reviewerError || !reviewerResult.user) {
      throw new Error(`Failed to create reviewer user: ${reviewerError?.message}`)
    }
    reviewerId = reviewerResult.user.id

    const authClient = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    const { error: signInError } = await authClient.auth.signInWithPassword({
      email: USER_EMAIL,
      password: USER_PASSWORD,
    })
    if (signInError) {
      throw new Error(`Failed to sign in test user: ${signInError.message}`)
    }
    mockedServerState.authClient = authClient

    const { data: brand, error: brandError } = await client
      .from('brands')
      .insert({
        name: 'ZZZ Claim Request Integration Brand',
        slug: BRAND_SLUG,
        description: 'Throwaway community brand for claim request integration tests',
        status: 'approved',
      })
      .select('id')
      .single()

    if (brandError || !brand) {
      throw new Error(`Failed to insert test brand: ${brandError?.message}`)
    }
    brandId = brand.id
  })

  beforeEach(async () => {
    const client = createTestClient()

    await client.from('claim_requests').delete().eq('brand_id', brandId)
    await client.from('brand_owners').delete().eq('brand_id', brandId)
    await client.from('brands').update({ contact_email: null }).eq('id', brandId)
  })

  afterAll(async () => {
    const client = createTestClient()

    await client.from('claim_requests').delete().eq('brand_id', brandId)
    await client.from('brand_owners').delete().eq('brand_id', brandId)
    await client.from('brands').delete().eq('id', brandId)

    if (userId) {
      await client.auth.admin.deleteUser(userId)
    }
    if (reviewerId) {
      await client.auth.admin.deleteUser(reviewerId)
    }

    if (mockedServerState.authClient) {
      await mockedServerState.authClient.auth.signOut()
      mockedServerState.authClient = null
    }
  })

  it('createClaimRequest stores a pending request', async () => {
    const request = await createClaimRequest({
      userId,
      brandId,
      proofType: 'domain_email',
      proofUrl: 'https://example.com/proof/domain-email',
      proofNotes: 'Can receive email at the official domain',
    })

    expect(request.status).toBe('pending')
    expect(request.brandId).toBe(brandId)
    expect(request.userId).toBe(userId)
    expect(request.proofType).toBe('domain_email')
  })

  it('createClaimRequest stores the MIT Smile cert when provided', async () => {
    const request = await createClaimRequest({
      userId,
      brandId,
      proofType: 'domain_email',
      mitSmileCert: '01200024-02134',
    })

    expect(request.mitSmileCert).toBe('01200024-02134')
  })

  it('createClaimRequest stores a null MIT Smile cert when omitted', async () => {
    const request = await createClaimRequest({
      userId,
      brandId,
      proofType: 'domain_email',
    })

    expect(request.mitSmileCert).toBeNull()
  })

  it('getClaimRequestById returns the claim with brand name/slug and requester email', async () => {
    const created = await createClaimRequest({
      brandId,
      userId,
      proofType: 'domain_email',
      proofUrl: `https://example.com/proof/${BRAND_SLUG}`,
      proofNotes: 'integration test',
    })

    const result = await getClaimRequestById(created.id)

    expect(result).not.toBeNull()
    expect(result!.id).toBe(created.id)
    expect(result!.brandName).toBe('ZZZ Claim Request Integration Brand')
    expect(result!.brandSlug).toBe(BRAND_SLUG)
    expect(result!.requesterEmail).toBe(USER_EMAIL)
  })

  it('approveClaimRequest claims the brand and marks the request approved', async () => {
    const request = await createClaimRequest({
      userId,
      brandId,
      proofType: 'social_post',
      proofUrl: 'https://example.com/proof/social-post',
      proofNotes: 'Posted ownership proof on the brand account',
    })

    await approveClaimRequest(request.id, reviewerId)

    const approved = await getClaimRequest(request.id)
    const ownedBrandIds = (await getUserBrands(userId)).map((brand) => brand.brandId)

    expect(approved.status).toBe('approved')
    expect(approved.reviewedBy).toBe(reviewerId)
    expect(ownedBrandIds).toContain(brandId)
  })

  it('rejectClaimRequest marks rejected and does not create ownership', async () => {
    const request = await createClaimRequest({
      userId,
      brandId,
      proofType: 'business_registration',
      proofNotes: 'Initial filing attached separately',
    })

    await rejectClaimRequest(request.id, reviewerId, 'Proof does not establish ownership yet')

    const rejected = await getClaimRequest(request.id)
    const ownedBrandIds = (await getUserBrands(userId)).map((brand) => brand.brandId)

    expect(rejected.status).toBe('rejected')
    expect(rejected.reviewedBy).toBe(reviewerId)
    expect(rejected.reviewerNotes).toBe('Proof does not establish ownership yet')
    expect(ownedBrandIds).not.toContain(brandId)
  })
})
