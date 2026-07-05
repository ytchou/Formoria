import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { approveSubmission, rejectSubmission } from '@/lib/services/submissions'
import { describeWithDb } from '@/test/setup'

const supabase =
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
      )
    : null

describeWithDb('admin submission rejection', () => {
  const testBrandName = '[TEST-REJECT] Submission First Brand'
  const reviewerId = '00000000-0000-4000-8000-000000000001'

  afterEach(async () => {
    await supabase!.from('brand_submissions').delete().eq('brand_name', testBrandName)
    await supabase!.from('brands').delete().eq('name', testBrandName)
  })

  it('rejects a submission without touching the brands table', async () => {
    const reviewerNotes = 'Not enough product details yet'

    const { data: inserted, error: insertError } = await supabase!
      .from('brand_submissions')
      .insert({
        brand_id: null,
        brand_name: testBrandName,
        submitter_email: 'reject-submission@example.com',
        status: 'pending',
      })
      .select('id')
      .single()

    expect(insertError).toBeNull()
    expect(inserted).not.toBeNull()

    await rejectSubmission(inserted!.id, reviewerId, 'insufficient_info', reviewerNotes)

    const { data: submission, error: submissionError } = await supabase!
      .from('brand_submissions')
      .select('status, reviewer_notes, reviewed_at, reviewed_by, brand_id')
      .eq('id', inserted!.id)
      .single()

    expect(submissionError).toBeNull()
    expect(submission).not.toBeNull()
    expect(submission!.status).toBe('rejected')
    expect(submission!.reviewer_notes).toBe(reviewerNotes)
    expect(submission!.reviewed_at).toEqual(expect.any(String))
    expect(submission!.reviewed_by).toBe(reviewerId)
    expect(submission!.brand_id).toBeNull()

    const { data: brands, error: brandsError } = await supabase!
      .from('brands')
      .select('id')
      .eq('name', testBrandName)

    expect(brandsError).toBeNull()
    expect(brands).toHaveLength(0)
  })
})

describe('rejectSubmissionAction', () => {
  const testSubmissionId = 'sub-1'
  const mockedModules = [
    'next/cache',
    '@/lib/supabase/server',
    '@/lib/auth/admin-mode',
    '@/lib/services/submissions',
    '@/lib/services/claim-requests',
    '@/lib/services/pending-edits',
    '@/lib/services/mit-verification',
    '@/lib/services/brands',
    '@/lib/services/brand-owners',
    '@/lib/services/moderation',
    '@/lib/email/send',
    '@/lib/email/templates',
    '@/lib/services/email-lifecycle',
    '@/lib/auth/claim-token',
    '@/lib/services/reports',
    '@/lib/services/feedback',
    '@/lib/services/health-checks',
  ]

  beforeEach(() => {
    vi.resetModules()

    vi.doMock('next/cache', () => ({
      revalidatePath: vi.fn(),
    }))

    vi.doMock('@/lib/supabase/server', () => ({
      createClient: vi.fn(async () => ({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'admin-1', email: 'admin@formoria.com' } },
            error: null,
          }),
        },
      })),
      createServiceClient: vi.fn(() => ({})),
    }))

    vi.doMock('@/lib/auth/admin-mode', () => ({
      isActingAsAdmin: vi.fn().mockResolvedValue(true),
    }))

    vi.doMock('@/lib/services/submissions', () => ({
      getSubmission: vi.fn().mockResolvedValue({
        id: testSubmissionId,
        brandName: 'Test Brand',
        submitterEmail: 'submitter@example.com',
      }),
      approveSubmission: vi.fn(),
      rejectSubmission: vi.fn().mockResolvedValue(undefined),
    }))

    vi.doMock('@/lib/services/claim-requests', () => ({
      approveClaimRequest: vi.fn(),
      getClaimRequest: vi.fn(),
      rejectClaimRequest: vi.fn(),
    }))

    vi.doMock('@/lib/services/pending-edits', () => ({
      approvePendingEdit: vi.fn(),
      getPendingEditForReview: vi.fn(),
      rejectPendingEdit: vi.fn(),
    }))

    vi.doMock('@/lib/services/mit-verification', () => ({
      verifyMitByCert: vi.fn(),
    }))

    vi.doMock('@/lib/services/brands', () => ({
      deleteBrand: vi.fn(),
      getBrandById: vi.fn(),
      syncBrandImages: vi.fn(),
      updateBrand: vi.fn(),
    }))

    vi.doMock('@/lib/services/brand-owners', () => ({
      getBrandOwnerEmail: vi.fn(),
      getUserBrandByEmail: vi.fn().mockResolvedValue(null),
    }))

    vi.doMock('@/lib/services/moderation', () => ({
      scanContent: vi.fn(),
      saveModerationFlags: vi.fn(),
      markFlagsReviewed: vi.fn(),
    }))

    vi.doMock('@/lib/email/send', () => ({
      sendEmail: vi.fn(),
    }))

    vi.doMock('@/lib/email/templates', () => ({
      buildApprovalEmail: vi.fn(),
      buildRejectionEmail: vi.fn().mockResolvedValue({}),
      buildClaimEmail: vi.fn(),
      buildClaimApprovedEmail: vi.fn(),
      buildClaimRejectedEmail: vi.fn(),
      buildEditApprovedEmail: vi.fn(),
      buildEditRejectedEmail: vi.fn(),
    }))

    vi.doMock('@/lib/services/email-lifecycle', () => ({
      createEmailPreferences: vi.fn(),
    }))

    vi.doMock('@/lib/auth/claim-token', () => ({
      generateClaimToken: vi.fn(),
    }))

    vi.doMock('@/lib/services/reports', () => ({
      updateReportStatus: vi.fn(),
    }))

    vi.doMock('@/lib/services/feedback', () => ({
      updateFeedbackStatus: vi.fn(),
      syncSentryFeedback: vi.fn(),
    }))

    vi.doMock('@/lib/services/health-checks', () => ({
      checkAllServices: vi.fn(),
    }))
  })

  afterEach(() => {
    mockedModules.forEach((moduleName) => vi.doUnmock(moduleName))
    vi.resetModules()
  })

  it('rejects with valid denial reason', async () => {
    const { rejectSubmissionAction } = await import('../actions')

    const result = await rejectSubmissionAction(testSubmissionId, 'not_mit', 'Not made in Taiwan')

    expect(result).toBeUndefined()
  })

  it('returns error when denial reason is other but notes are empty', async () => {
    const { rejectSubmissionAction } = await import('../actions')

    const result = await rejectSubmissionAction(testSubmissionId, 'other', '')

    expect(result).toEqual({ error: expect.stringContaining('required') })
  })

  it('returns error for invalid denial reason', async () => {
    const { rejectSubmissionAction } = await import('../actions')

    const result = await rejectSubmissionAction(testSubmissionId, 'invalid_reason' as never, '')

    expect(result).toEqual({ error: expect.stringContaining('Invalid') })
  })

  describe('edit email locale wiring', () => {
    async function mockPendingEditEmailContext(localePreference: 'zh-TW' | 'en' | null) {
      const { createServiceClient } = await import('@/lib/supabase/server')
      const { getBrandOwnerEmail } = await import('@/lib/services/brand-owners')
      const { getPendingEditForReview } = await import('@/lib/services/pending-edits')

      vi.mocked(getPendingEditForReview).mockResolvedValue({
        brandId: 'brand-1',
        brandName: 'Test Brand',
      } as never)
      vi.mocked(getBrandOwnerEmail).mockResolvedValue('owner@example.com')
      vi.mocked(createServiceClient).mockReturnValue({
        from: vi.fn((table: string) => {
          if (table === 'brand_owners') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  limit: vi.fn(() => ({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: { user_id: 'owner-1' },
                      error: null,
                    }),
                  })),
                })),
              })),
            }
          }

          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { locale_preference: localePreference },
                  error: null,
                }),
              })),
            })),
          }
        }),
      } as never)
    }

    it('approvePendingEditAction passes owner locale to email builder', async () => {
      await mockPendingEditEmailContext('en')
      const { buildEditApprovedEmail } = await import('@/lib/email/templates')
      vi.mocked(buildEditApprovedEmail).mockResolvedValue({} as never)

      const { approvePendingEditAction } = await import('../actions')
      const result = await approvePendingEditAction('edit-1')

      expect(result).toBeUndefined()
      expect(buildEditApprovedEmail).toHaveBeenCalledWith({
        brandName: 'Test Brand',
        ownerEmail: 'owner@example.com',
        locale: 'en',
      })
    })

    it('rejectPendingEditAction passes owner locale to email builder', async () => {
      await mockPendingEditEmailContext('zh-TW')
      const { buildEditRejectedEmail } = await import('@/lib/email/templates')
      vi.mocked(buildEditRejectedEmail).mockResolvedValue({} as never)

      const { rejectPendingEditAction } = await import('../actions')
      const result = await rejectPendingEditAction('edit-1', 'Please add clearer product details')

      expect(result).toBeUndefined()
      expect(buildEditRejectedEmail).toHaveBeenCalledWith({
        brandName: 'Test Brand',
        ownerEmail: 'owner@example.com',
        notes: 'Please add clearer product details',
        locale: 'zh-TW',
      })
    })

    it('defaults to zh-TW when owner has no locale preference', async () => {
      await mockPendingEditEmailContext(null)
      const { buildEditApprovedEmail } = await import('@/lib/email/templates')
      vi.mocked(buildEditApprovedEmail).mockResolvedValue({} as never)

      const { approvePendingEditAction } = await import('../actions')
      const result = await approvePendingEditAction('edit-1')

      expect(result).toBeUndefined()
      expect(buildEditApprovedEmail).toHaveBeenCalledWith({
        brandName: 'Test Brand',
        ownerEmail: 'owner@example.com',
        locale: 'zh-TW',
      })
    })
  })
})

describeWithDb('approveSubmissionAction (submission-first)', () => {
  const testBrandNamePrefix = '[TEST-APPROVE]'
  const reviewerId = 'admin@example.com'
  const submissionIds: string[] = []
  const brandIds: string[] = []

  afterEach(async () => {
    if (submissionIds.length > 0) {
      await supabase!.from('brand_submissions').delete().in('id', submissionIds)
      submissionIds.length = 0
    }

    if (brandIds.length > 0) {
      await supabase!.from('brands').delete().in('id', brandIds)
      brandIds.length = 0
    }

    const { data: leftoverBrands } = await supabase!
      .from('brands')
      .select('id')
      .like('name', `${testBrandNamePrefix}%`)

    const leftoverBrandIds = (leftoverBrands ?? []).map((brand) => brand.id)
    if (leftoverBrandIds.length > 0) {
      await supabase!.from('brands').delete().in('id', leftoverBrandIds)
    }

    await supabase!
      .from('brand_submissions')
      .delete()
      .like('brand_name', `${testBrandNamePrefix}%`)
  })

  it('creates a brand from submission fields + enriched_data on approval', async () => {
    const testBrandName = `${testBrandNamePrefix} Enriched Brand`
    const { data: inserted, error: insertError } = await supabase!
      .from('brand_submissions')
      .insert({
        brand_id: null,
        brand_name: testBrandName,
        submitter_email: 'approve-enriched@example.com',
        description: 'Submission description',
        purchase_website: 'https://submission.example.com',
        social_instagram: 'submission_ig',
        status: 'pending',
        enriched_data: {
          description: 'Enriched description',
          hero_image_url: 'https://cdn.example.com/hero.jpg',
          product_photos: ['https://cdn.example.com/product-1.jpg'],
          product_type: 'crafts',
        },
      })
      .select('id')
      .single()

    expect(insertError).toBeNull()
    expect(inserted).not.toBeNull()
    submissionIds.push(inserted!.id)

    const result = await approveSubmission(supabase!, inserted!.id, reviewerId)
    brandIds.push(result.brandId)

    const { data: brand, error: brandError } = await supabase!
      .from('brands')
      .select('id, name, status, description, hero_image_url, product_photos, product_type, purchase_website, social_instagram')
      .eq('id', result.brandId)
      .single()

    expect(brandError).toBeNull()
    expect(brand).not.toBeNull()
    expect(brand!.name).toBe(testBrandName)
    expect(brand!.status).toBe('approved')
    expect(brand!.description).toBe('Enriched description')
    expect(brand!.hero_image_url).toBe('https://cdn.example.com/hero.jpg')
    expect(brand!.product_photos).toEqual(['https://cdn.example.com/product-1.jpg'])
    expect(brand!.product_type).toBe('crafts')
    expect(brand!.purchase_website).toBe('https://submission.example.com')
    expect(brand!.social_instagram).toBe('submission_ig')

    const { data: submission, error: submissionError } = await supabase!
      .from('brand_submissions')
      .select('brand_id, status')
      .eq('id', inserted!.id)
      .single()

    expect(submissionError).toBeNull()
    expect(submission).not.toBeNull()
    expect(submission!.brand_id).toBe(result.brandId)
    expect(submission!.status).toBe('approved')
  })

  it('applies admin overrides with highest priority', async () => {
    const testBrandName = `${testBrandNamePrefix} Override Brand`
    const { data: inserted, error: insertError } = await supabase!
      .from('brand_submissions')
      .insert({
        brand_id: null,
        brand_name: testBrandName,
        submitter_email: 'approve-overrides@example.com',
        description: 'Submission description',
        status: 'pending',
        enriched_data: {
          description: 'Enriched description',
          product_type: 'crafts',
        },
      })
      .select('id')
      .single()

    expect(insertError).toBeNull()
    expect(inserted).not.toBeNull()
    submissionIds.push(inserted!.id)

    const result = await approveSubmission(supabase!, inserted!.id, reviewerId, {
      description: 'Admin override description',
    })
    brandIds.push(result.brandId)

    const { data: brand, error: brandError } = await supabase!
      .from('brands')
      .select('description, product_type')
      .eq('id', result.brandId)
      .single()

    expect(brandError).toBeNull()
    expect(brand).not.toBeNull()
    expect(brand!.description).toBe('Admin override description')
    expect(brand!.product_type).toBe('crafts')
  })
})
