import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { rejectSubmission } from '@/lib/services/submissions'
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
    '@/lib/services/mit-verification',
    '@/lib/services/brands',
    '@/lib/services/brand-owners',
    '@/lib/services/moderation',
    '@/lib/email/send',
    '@/lib/email/templates',
    '@/lib/services/email-lifecycle',
    '@/lib/auth/claim-token',
    '@/lib/services/reports',
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
      isGeneratedGuestSubmissionEmail: vi.fn(() => false),
    }))

    vi.doMock('@/lib/services/claim-requests', () => ({
      approveClaimRequest: vi.fn(),
      getClaimRequest: vi.fn(),
      rejectClaimRequest: vi.fn(),
    }))

    vi.doMock('@/lib/services/mit-verification', () => ({
      verifyMitByCert: vi.fn(),
    }))

    vi.doMock('@/lib/services/brands', () => ({
      deleteBrand: vi.fn(),
      getBrandById: vi.fn().mockResolvedValue({
        id: 'brand-niizo',
        slug: 'niizo',
      }),
      syncBrandImages: vi.fn(),
      updateBrand: vi.fn(),
    }))

    vi.doMock('@/lib/services/brand-owners', () => ({
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

})
