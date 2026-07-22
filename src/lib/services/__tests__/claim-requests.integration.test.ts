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
  listClaimRequests,
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

type CleanupJobsTestTable = {
  insert(values: Record<string, unknown>[]): PromiseLike<{
    error: { message: string } | null
  }>
  delete(): {
    like(column: 'storage_key', pattern: string): PromiseLike<{
      error: { message: string } | null
    }>
  }
}

function cleanupJobsTable(client: SupabaseClient): CleanupJobsTestTable {
  return (client as unknown as { from(table: string): CleanupJobsTestTable })
    .from('claim_proof_cleanup_jobs')
}

it('createClaimRequest rejects image keys outside the user namespace before writing', async () => {
  await expect(
    createClaimRequest({
      userId: 'user-a',
      brandId: 'brand-a',
      proofEvidence: [
        { type: 'domain_email', url: 'owner@brand.com' },
        { type: 'backend_screenshot', imageKey: 'claim-proofs/user-b/brand-a/proof.webp' },
      ],
    })
  ).rejects.toThrow(/invalid image key/i)
})

it('createClaimRequest rejects invalid domain email proof before writing', async () => {
  await expect(
    createClaimRequest({
      userId: 'user-a',
      brandId: 'brand-a',
      proofEvidence: [{ type: 'domain_email', url: 'https://brand.example/proof' }],
    })
  ).rejects.toThrow(/valid email/i)
})

it('createClaimRequest rejects upload-backed proof without an image key before writing', async () => {
  await expect(
    createClaimRequest({
      userId: 'user-a',
      brandId: 'brand-a',
      proofEvidence: [{ type: 'business_doc' }],
    })
  ).rejects.toThrow(/image key/i)
})

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

    await cleanupJobsTable(client).delete().like(
      'storage_key',
      `claim-proofs/${userId}/${brandId}/%`
    )
    await client.from('claim_requests').delete().eq('brand_id', brandId)
    await client.from('brand_owners').delete().eq('brand_id', brandId)
    await client.from('brands').update({ contact_email: null }).eq('id', brandId)
  })

  afterAll(async () => {
    const client = createTestClient()

    await cleanupJobsTable(client).delete().like(
      'storage_key',
      `claim-proofs/${userId}/${brandId}/%`
    )
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
      proofEvidence: [
        {
          type: 'domain_email',
          url: 'owner@example.com',
          note: 'Can receive email at the official domain',
        },
        {
          type: 'backend_screenshot',
          imageKey: `claim-proofs/${userId}/${brandId}/pending.webp`,
        },
      ],
    })

    expect(request.status).toBe('pending')
    expect(request.brandId).toBe(brandId)
    expect(request.userId).toBe(userId)
    expect(request.proofEvidence[0]?.type).toBe('domain_email')
  })

  it('createClaimRequest stores the MIT Smile cert when provided', async () => {
    const request = await createClaimRequest({
      userId,
      brandId,
      proofEvidence: [
        { type: 'domain_email', url: 'owner@brand.com' },
        {
          type: 'backend_screenshot',
          imageKey: `claim-proofs/${userId}/${brandId}/mit.webp`,
        },
      ],
      mitSmileCert: '01200024-02134',
    })

    expect(request.mitSmileCert).toBe('01200024-02134')
  })

  it('createClaimRequest stores a null MIT Smile cert when omitted', async () => {
    const request = await createClaimRequest({
      userId,
      brandId,
      proofEvidence: [
        { type: 'domain_email', url: 'owner@brand.com' },
        {
          type: 'backend_screenshot',
          imageKey: `claim-proofs/${userId}/${brandId}/no-mit.webp`,
        },
      ],
    })

    expect(request.mitSmileCert).toBeNull()
  })

  it('persists proof_evidence array and maps it back to proofEvidence', async () => {
    const claim = await createClaimRequest({
      brandId,
      userId,
      proofEvidence: [
        { type: 'domain_email', url: 'owner@brand.com', note: 'owner mailbox' },
        { type: 'backend_screenshot', imageKey: `claim-proofs/${userId}/${brandId}/a.webp` },
      ],
      mitSmileCert: '01200024-02134',
    })

    expect(claim.proofEvidence).toHaveLength(2)
    expect(claim.proofEvidence[0]).toMatchObject({
      type: 'domain_email',
      url: 'owner@brand.com',
    })
    expect(claim.proofEvidence[1]).toMatchObject({
      type: 'backend_screenshot',
      imageKey: expect.stringContaining('claim-proofs/'),
    })
    expect(claim.mitSmileCert).toBe('01200024-02134')
  })

  it('rejects when no proofs are provided', async () => {
    await expect(
      createClaimRequest({
        brandId,
        userId,
        proofEvidence: [],
      })
    ).rejects.toThrow(/at least 1|1 proof/i)
  })

  it('approveClaimRequest claims the brand and marks the request approved', async () => {
    const request = await createClaimRequest({
      userId,
      brandId,
      proofEvidence: [
        {
          type: 'backend_screenshot',
          imageKey: `claim-proofs/${userId}/${brandId}/approve.webp`,
          note: 'Posted ownership proof on the brand account',
        },
      ],
    })

    await approveClaimRequest(request.id, reviewerId)

    const approved = await getClaimRequest(request.id)
    const ownedBrandIds = (await getUserBrands(userId)).map((brand) => brand.brandId)

    expect(approved.status).toBe('approved')
    expect(approved.reviewedBy).toBe(reviewerId)
    expect(ownedBrandIds).toContain(brandId)
  })

  it('does not approve an unverified domain-email claim or mutate ownership', async () => {
    const request = await createClaimRequest({
      userId,
      brandId,
      proofEvidence: [{ type: 'domain_email', url: 'owner@example.com' }],
    })

    await expect(approveClaimRequest(request.id, reviewerId)).rejects.toMatchObject({
      name: 'ValidationError',
      code: 'VALIDATION_ERROR',
      message: 'Domain email proof must be verified before approval',
    })

    const pending = await getClaimRequest(request.id)
    const ownedBrandIds = (await getUserBrands(userId)).map((brand) => brand.brandId)
    expect(pending.status).toBe('pending')
    expect(ownedBrandIds).not.toContain(brandId)
  })

  it('does not allow an ordinary authenticated client to execute the approval RPC directly', async () => {
    const request = await createClaimRequest({
      userId,
      brandId,
      proofEvidence: [
        {
          type: 'business_doc',
          imageKey: `claim-proofs/${userId}/${brandId}/rpc.webp`,
        },
      ],
    })

    const { error } = await mockedServerState.authClient!.rpc('approve_claim_request', {
      p_claim_id: request.id,
      p_reviewer_id: userId,
    })

    expect(error).not.toBeNull()
    const pending = await getClaimRequest(request.id)
    const ownedBrandIds = (await getUserBrands(userId)).map((brand) => brand.brandId)
    expect(pending.status).toBe('pending')
    expect(ownedBrandIds).not.toContain(brandId)
  })

  it('maps cleanup status for terminal claims from one batched job lookup', async () => {
    const client = createTestClient()
    const cases = [
      {
        suffix: 'completed',
        status: 'approved',
        proofKeys: ['completed-a', 'completed-b'],
        jobStatuses: ['completed', 'completed'],
        expected: 'completed',
      },
      {
        suffix: 'failed',
        status: 'rejected',
        proofKeys: ['failed-completed', 'failed-error'],
        jobStatuses: ['completed', 'failed'],
        expected: 'failed',
      },
      {
        suffix: 'processing',
        status: 'rejected',
        proofKeys: ['processing'],
        jobStatuses: ['processing'],
        expected: 'pending',
      },
      {
        suffix: 'missing',
        status: 'approved',
        proofKeys: ['missing-completed', 'missing-no-job'],
        jobStatuses: ['completed'],
        expected: 'pending',
      },
      {
        suffix: 'deduplicated',
        status: 'approved',
        proofKeys: ['deduplicated', 'deduplicated'],
        jobStatuses: ['completed'],
        expected: 'completed',
      },
      {
        suffix: 'still-pending',
        status: 'pending',
        proofKeys: ['still-pending'],
        jobStatuses: [],
        expected: null,
      },
      {
        suffix: 'no-upload',
        status: 'rejected',
        proofKeys: [],
        jobStatuses: [],
        expected: null,
      },
    ] as const
    const { data: inserted, error: insertError } = await client
      .from('claim_requests')
      .insert(cases.map((testCase) => ({
        brand_id: brandId,
        user_id: userId,
        status: testCase.status,
        proof_evidence: testCase.proofKeys.length > 0
          ? testCase.proofKeys.map((proofKey) => ({
              type: 'business_doc',
              imageKey: `claim-proofs/${userId}/${brandId}/status-${proofKey}.webp`,
            }))
          : [{ type: 'domain_email', url: 'owner@example.com', verified: true }],
      })))
      .select('id, proof_evidence')

    expect(insertError).toBeNull()
    expect(inserted).toHaveLength(cases.length)

    const jobs = cases.flatMap((testCase, index) => {
      const claim = inserted?.[index]
      if (!claim) return []
      return testCase.proofKeys.flatMap((proofKey, jobIndex) => {
        const status = testCase.jobStatuses[jobIndex]
        return status
          ? [{
              claim_request_id: claim.id,
              storage_key: `claim-proofs/${userId}/${brandId}/status-${proofKey}.webp`,
              reason: 'decision',
              status,
            }]
          : []
      })
    })
    const { error: jobsError } = await cleanupJobsTable(client).insert(jobs)
    expect(jobsError).toBeNull()

    const claims = await listClaimRequests()
    const claimsById = new Map(claims.map((claim) => [claim.id, claim]))
    cases.forEach((testCase, index) => {
      expect(claimsById.get(inserted?.[index]?.id ?? '')?.proofCleanupStatus).toBe(
        testCase.expected
      )
    })
  })

  it('rejectClaimRequest marks rejected and does not create ownership', async () => {
    const request = await createClaimRequest({
      userId,
      brandId,
      proofEvidence: [
        { type: 'business_doc', imageKey: `claim-proofs/${userId}/${brandId}/doc.webp` },
        {
          type: 'backend_screenshot',
          imageKey: `claim-proofs/${userId}/${brandId}/reject.webp`,
          note: 'Initial filing attached separately',
        },
      ],
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
