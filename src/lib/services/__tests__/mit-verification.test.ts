import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { createTestClient, describeWithDb } from '@/test/setup'
import { rejectMitStatus, verifyMitStatus } from '../mit-verification'

const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const BRAND_SLUG = `zzz-mit-verification-itest-${RUN_ID}`
const REVIEWER_EMAIL = `mit-verification-reviewer-${RUN_ID}@example.com`

let brandId = ''
let reviewerId = ''

describeWithDb('mit verification service (integration)', () => {
  beforeAll(async () => {
    const client = createTestClient()

    const { data: reviewerResult, error: reviewerError } = await client.auth.admin.createUser({
      email: REVIEWER_EMAIL,
      password: 'MitVerify123!',
      email_confirm: true,
    })
    if (reviewerError || !reviewerResult.user) {
      throw new Error(`Failed to create reviewer user: ${reviewerError?.message}`)
    }
    reviewerId = reviewerResult.user.id

    const { data: brand, error: brandError } = await client
      .from('brands')
      .insert({
        name: 'ZZZ MIT Verification Integration Brand',
        slug: BRAND_SLUG,
        description: 'Throwaway brand for MIT verification integration tests',
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

    await client
      .from('brands')
      .update({
        mit_status: 'unverified',
        mit_verified_at: null,
        mit_evidence: null,
      })
      .eq('id', brandId)
  })

  afterAll(async () => {
    const client = createTestClient()

    if (brandId) {
      await client.from('brands').delete().eq('id', brandId)
    }

    if (reviewerId) {
      await client.auth.admin.deleteUser(reviewerId)
    }
  })

  it('verifyMitStatus marks the brand as verified with MIT Smile evidence', async () => {
    const brand = await verifyMitStatus(brandId, '01200024-02134', reviewerId)

    expect(brand.mitStatus).toBe('verified')
    expect(brand.mitVerified).toBe(true)
    expect(brand.mitVerifiedAt).not.toBeNull()
    expect(brand.mitEvidence?.mit_smile_listed).toBe(true)
    expect(brand.mitEvidence?.mit_smile_cert).toBe('01200024-02134')
    expect(brand.mitEvidence?.verified_source).toBe('mit_smile_registry')
  })

  it('rejectMitStatus marks the brand as rejected', async () => {
    const brand = await rejectMitStatus(brandId, reviewerId, 'Cert not found in registry')

    expect(brand.mitStatus).toBe('rejected')
  })
})
