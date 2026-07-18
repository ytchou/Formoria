import { revalidatePath } from 'next/cache'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { refreshHealthChecks, setFeatureFlagAction } from './actions'
import { checkAllServices } from '@/lib/services/health-checks'

// Mocks must be at top-level for vitest hoisting
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'admin-1', email: 'admin@formoria.com' } },
      }),
    },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { brand_id: 'brand-1', brands: { name: 'Test Brand' } },
            error: null,
          }),
        }),
      }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    })),
  })),
  createServiceClient: vi.fn(() => ({
    auth: {
      admin: {
        getUserById: vi.fn().mockResolvedValue({
          data: { user: { email: 'owner@example.com' } },
          error: null,
        }),
      },
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          maybeSingle: vi.fn().mockResolvedValue({ data: { user_id: 'owner-1' }, error: null }),
          limit: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: { user_id: 'owner-1' }, error: null }),
          }),
        }),
      }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    }),
  })),
}))

vi.mock('@/lib/auth/admin', () => ({
  isAdmin: vi.fn().mockReturnValue(true),
}))

vi.mock('@/lib/auth/admin-mode', () => ({
  isActingAsAdmin: vi.fn().mockResolvedValue(true),
}))

vi.mock('@/lib/auth/require-admin', () => ({
  requireAdminAction: vi.fn().mockResolvedValue({
    user: { id: 'admin-1', email: 'admin@formoria.com' },
  }),
}))

vi.mock('@/lib/security/rate-limiter', () => ({
  rateLimit: vi.fn().mockResolvedValue({ success: true, remaining: 10 }),
}))

vi.mock('@/lib/services/brands', () => ({
  getBrandBySlug: vi.fn(),
  getBrandById: vi.fn().mockResolvedValue({ id: 'brand-1', name: 'Test Brand', slug: 'test-brand' }),
  updateBrand: vi.fn().mockResolvedValue({ id: 'brand-1', slug: 'test-brand' }),
  createBrand: vi.fn(),
  deleteBrand: vi.fn(),
  generateSlug: vi.fn(),
  syncBrandImages: vi.fn().mockResolvedValue({ synced: 0, failed: 0 }),
}))

vi.mock('@/lib/services/brand-owners', () => ({
  getUserBrandByEmail: vi.fn().mockResolvedValue(null),
  revokeOwnership: vi.fn(),
}))

vi.mock('@/lib/services/submissions', () => ({
  getSubmission: vi.fn(),
  approveSubmission: vi.fn(),
  rejectSubmission: vi.fn(),
  isGeneratedGuestSubmissionEmail: vi.fn(() => false),
}))

vi.mock('@/lib/services/moderation', () => ({
  scanContent: vi.fn().mockReturnValue({ riskLevel: 'clean', flags: [] }),
  saveModerationFlags: vi.fn().mockResolvedValue(undefined),
  markFlagsReviewed: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/services/claim-requests', () => ({
  getClaimRequest: vi.fn(),
  approveClaimRequest: vi.fn().mockResolvedValue(undefined),
  rejectClaimRequest: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/services/mit-verification', () => ({
  verifyMitByCert: vi.fn().mockResolvedValue({ data: { id: 'brand-1', name: 'Test Brand' } }),
}))

vi.mock('@/lib/services/reports', () => ({
  updateReportStatus: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/services/feedback', () => ({
  updateFeedbackStatus: vi.fn().mockResolvedValue(undefined),
  syncSentryFeedback: vi.fn().mockResolvedValue({ synced: 3, errors: 0 }),
}))

vi.mock('@/lib/services/health-checks', () => ({
  checkAllServices: vi.fn(),
}))

vi.mock('@/lib/services/app-settings', () => ({
  SUBCATEGORY_FILTER_KEY: 'subcategory_filter_enabled',
  setAppSetting: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/email/resend-adapter', () => ({
  createResendProvider: vi.fn(() => ({ send: vi.fn() })),
}))

vi.mock('@/lib/email/send', () => ({
  sendEmail: vi.fn(),
}))

vi.mock('@/lib/email/templates', () => ({
  buildApprovalEmail: vi.fn(),
  buildRejectionEmail: vi.fn(),
  buildClaimEmail: vi.fn(),
  buildClaimApprovedEmail: vi.fn(),
  buildClaimRejectedEmail: vi.fn(),
  buildOwnershipRevokedEmail: vi.fn(),
}))

vi.mock('@/lib/services/email-lifecycle', () => ({
  createEmailPreferences: vi.fn().mockResolvedValue({ data: {}, error: null }),
}))

vi.mock('@/lib/services/profiles', () => ({
  getOwnerLocale: vi.fn().mockResolvedValue('zh-TW'),
}))

vi.mock('@/lib/auth/claim-token', () => ({
  generateClaimToken: vi.fn(),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

describe('admin actions module', () => {
  it('exports all required action functions', async () => {
    const mod = await import('./actions')

    expect(typeof mod.approveSubmissionAction).toBe('function')
    expect(typeof mod.rejectSubmissionAction).toBe('function')
    expect(typeof mod.updateBrandAction).toBe('function')
    expect(typeof mod.hideBrandAction).toBe('function')
    expect(typeof mod.unhideBrandAction).toBe('function')
    expect(typeof mod.deleteBrandAction).toBe('function')
  })
})

describe('approveClaimAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates email preferences after approving a claim', async () => {
    const { getClaimRequest, approveClaimRequest } = await import('@/lib/services/claim-requests')
    const { createEmailPreferences } = await import('@/lib/services/email-lifecycle')
    vi.mocked(getClaimRequest).mockResolvedValue({
      id: 'claim-1',
      brandId: 'brand-1',
      userId: 'owner-1',
      proofType: 'domain_email',
      proofUrl: null,
      proofNotes: null,
      proofEvidence: [],
      mitSmileCert: null,
      status: 'pending',
      reviewerNotes: null,
      reviewedAt: null,
      reviewedBy: null,
      createdAt: '2026-01-01T00:00:00Z',
      brandName: 'Test Brand',
      brandSlug: 'test-brand',
      requesterEmail: 'owner@example.com',
    })

    const { approveClaimAction } = await import('./actions')
    const result = await approveClaimAction('claim-1')

    expect(result).toBeUndefined()
    expect(approveClaimRequest).toHaveBeenCalledWith('claim-1', 'admin-1')
    expect(createEmailPreferences).toHaveBeenCalledWith(expect.anything(), 'owner-1')
  })

  it("claim-approved email is delivered in the owner's preferred language", async () => {
    const { getClaimRequest } = await import('@/lib/services/claim-requests')
    const { getOwnerLocale } = await import('@/lib/services/profiles')
    const { buildClaimApprovedEmail } = await import('@/lib/email/templates')
    vi.mocked(getOwnerLocale).mockResolvedValueOnce('en')
    vi.mocked(buildClaimApprovedEmail).mockResolvedValue({
      to: 'owner@example.com',
      from: 'ops@formoria.com',
      subject: 'claim approved',
      html: '',
    })
    vi.mocked(getClaimRequest).mockResolvedValue({
      id: 'claim-1',
      brandId: 'brand-1',
      userId: 'owner-1',
      proofType: 'domain_email',
      proofUrl: null,
      proofNotes: null,
      proofEvidence: [],
      mitSmileCert: null,
      status: 'pending',
      reviewerNotes: null,
      reviewedAt: null,
      reviewedBy: null,
      createdAt: '2026-01-01T00:00:00Z',
      brandName: 'Test Brand',
      brandSlug: 'test-brand',
      requesterEmail: 'owner@example.com',
    })

    const { approveClaimAction } = await import('./actions')
    await approveClaimAction('claim-1')

    expect(buildClaimApprovedEmail).toHaveBeenCalledWith(
      expect.objectContaining({ locale: 'en' }),
    )
  })
})

describe('approveSubmissionAction - approval flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('delegates tag application to approveSubmission service on approval', async () => {
    const { getSubmission, approveSubmission } = await import('@/lib/services/submissions')
    const { updateBrand } = await import('@/lib/services/brands')
    const submission = {
      id: 'sub-1',
      brandId: 'brand-1',
      brandName: 'Test Brand',
      description: 'Test description',
      submitterName: null,
      submitterEmail: 'submitter@example.com',
      websiteUrl: null,
      isBrandOwner: false,
      socialLinks: [],
      suggestedTags: { values: ['eco-friendly', 'handmade'] },
      status: 'pending',
      reviewerNotes: null,
      submittedAt: '2026-01-01T00:00:00Z',
      reviewedAt: null,
      reviewedBy: null,
      pdpaConsentAt: null,
      validationStatus: null,
      validationErrors: null,
      notifiedAt: null,
    } as unknown as Awaited<ReturnType<typeof getSubmission>>
    vi.mocked(getSubmission).mockResolvedValue(submission)
    vi.mocked(updateBrand).mockResolvedValue({ id: 'brand-1', slug: 'test-brand' } as Awaited<ReturnType<typeof updateBrand>>)
    vi.mocked(approveSubmission).mockResolvedValue({ brandId: 'brand-1', submitterEmail: 'submitter@example.com', brandName: 'Test Brand', submitterName: null, isBrandOwner: false })

    const { approveSubmissionAction } = await import('./actions')
    const result = await approveSubmissionAction('sub-1')

    expect(result).toBeUndefined()
    expect(approveSubmission).toHaveBeenCalledWith('sub-1', 'admin-1')
  })

  it('approveSubmissionAction calls markFlagsReviewed', async () => {
    const { getSubmission, approveSubmission } = await import('@/lib/services/submissions')
    const { updateBrand } = await import('@/lib/services/brands')
    const { markFlagsReviewed } = await import('@/lib/services/moderation')
    const submission = {
      id: 'sub-1',
      brandId: 'brand-1',
      brandName: 'Test Brand',
      description: 'Test description',
      submitterName: null,
      submitterEmail: 'submitter@example.com',
      websiteUrl: null,
      isBrandOwner: false,
      socialLinks: [],
      suggestedTags: null,
      status: 'pending',
      reviewerNotes: null,
      submittedAt: '2026-01-01T00:00:00Z',
      reviewedAt: null,
      reviewedBy: null,
      pdpaConsentAt: null,
      validationStatus: null,
      validationErrors: null,
      notifiedAt: null,
    } as unknown as Awaited<ReturnType<typeof getSubmission>>
    vi.mocked(getSubmission).mockResolvedValue(submission)
    vi.mocked(updateBrand).mockResolvedValue({ id: 'brand-1', slug: 'test-brand' } as Awaited<ReturnType<typeof updateBrand>>)
    vi.mocked(approveSubmission).mockResolvedValue({ brandId: 'brand-1', submitterEmail: 'submitter@example.com', brandName: 'Test Brand', submitterName: null, isBrandOwner: false })

    const { approveSubmissionAction } = await import('./actions')
    const result = await approveSubmissionAction('sub-1')

    expect(result).toBeUndefined()
    expect(markFlagsReviewed).toHaveBeenCalledWith('brand-1')
  })
})

describe('updateBrandAction moderation audit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('updateBrandAction (admin edit) calls scanContent and saveModerationFlags when violations exist, then markFlagsReviewed', async () => {
    const { updateBrand } = await import('@/lib/services/brands')
    const { scanContent, saveModerationFlags, markFlagsReviewed } = await import('@/lib/services/moderation')
    const violations = [
      { field: 'description', rule: 'contact_injection_phone', userMessage: 'Phone detected' },
    ]
    vi.mocked(scanContent).mockReturnValue({ violations })

    const { updateBrandAction } = await import('./actions')
    const result = await updateBrandAction('brand-1', {
      name: 'Test Brand',
      description: 'bad word',
      category: 'apparel',
    })

    expect(result).toBeUndefined()
    expect(updateBrand).toHaveBeenCalledWith('brand-1', {
      name: 'Test Brand',
      description: 'bad word',
      category: 'apparel',
    })
    expect(scanContent).toHaveBeenCalledWith('Test Brand', {
      name: 'Test Brand',
      description: 'bad word',
      website: undefined,
      purchaseUrl: undefined,
      socialInstagram: undefined,
      socialThreads: undefined,
      socialFacebook: undefined,
      purchaseWebsite: undefined,
      purchasePinkoi: undefined,
      purchaseShopee: undefined,
    })
    expect(saveModerationFlags).toHaveBeenCalledWith('brand-1', 'admin-1', violations)
    expect(markFlagsReviewed).toHaveBeenCalledWith('brand-1')
  })
})

describe('reviewReportAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns undefined on success when admin', async () => {
    const { reviewReportAction } = await import('./actions')
    const result = await reviewReportAction('report-uuid-1', 'reviewed')
    expect(result).toBeUndefined()
  })

  it('returns error when not admin', async () => {
    const { requireAdminAction } = await import('@/lib/auth/require-admin')
    vi.mocked(requireAdminAction).mockResolvedValueOnce({
      error: 'You are not authorized to perform this action',
      code: 'forbidden',
    })
    const { reviewReportAction } = await import('./actions')
    const result = await reviewReportAction('report-uuid-1', 'reviewed')
    expect(result?.error).toBeTruthy()
  })

  it('requireAdmin denies a user without admin access', async () => {
    const { requireAdminAction } = await import('@/lib/auth/require-admin')
    vi.mocked(requireAdminAction).mockResolvedValueOnce({
      error: 'You are not authorized to perform this action',
      code: 'forbidden',
    })
    const { reviewReportAction } = await import('./actions')
    const result = await reviewReportAction('report-uuid-1', 'reviewed')
    expect(result).toMatchObject({ error: expect.any(String) })
  })
})

describe('revokeOwnershipAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('requires admin', async () => {
    const { requireAdminAction } = await import('@/lib/auth/require-admin')
    const { revokeOwnership } = await import('@/lib/services/brand-owners')
    vi.mocked(requireAdminAction).mockResolvedValueOnce({
      error: 'You are not authorized to perform this action',
      code: 'forbidden',
    })

    const { revokeOwnershipAction } = await import('./actions')
    const result = await revokeOwnershipAction('brand-uuid-123', 'Dispute upheld')

    expect(result).toMatchObject({ error: expect.any(String) })
    expect(revokeOwnership).not.toHaveBeenCalled()
  })

  it('revokes, emails the ex-owner, and revalidates the brand page', async () => {
    const { revokeOwnership } = await import('@/lib/services/brand-owners')
    const { sendEmail } = await import('@/lib/email/send')
    vi.mocked(revokeOwnership).mockResolvedValueOnce({
      userId: 'user-uuid-9',
      email: 'owner@haoshan-tea.tw',
    })

    const { revokeOwnershipAction } = await import('./actions')
    const result = await revokeOwnershipAction('brand-uuid-123', 'Dispute upheld')

    expect(revokeOwnership).toHaveBeenCalledWith(
      'brand-uuid-123',
      'admin@formoria.com',
      'Dispute upheld'
    )
    expect(sendEmail).toHaveBeenCalled()
    expect(revalidatePath).toHaveBeenCalledWith('/admin/reports')
    expect(result).toBeUndefined()
  })

  it('rejects an empty reason', async () => {
    const { revokeOwnership } = await import('@/lib/services/brand-owners')
    const { revokeOwnershipAction } = await import('./actions')

    const result = await revokeOwnershipAction('brand-uuid-123', '   ')

    expect(result).toMatchObject({ error: expect.any(String) })
    expect(revokeOwnership).not.toHaveBeenCalled()
  })
})

describe('reviewFeedbackAction', () => {
  it('calls updateFeedbackStatus and revalidates /admin/feedback', async () => {
    const { reviewFeedbackAction } = await import('./actions')
    const { updateFeedbackStatus } = await import('@/lib/services/feedback')

    const result = await reviewFeedbackAction('feedback-id-1', 'reviewed')

    expect(updateFeedbackStatus).toHaveBeenCalledWith('feedback-id-1', 'reviewed')
    expect(revalidatePath).toHaveBeenCalledWith('/admin/feedback')
    expect(result).toBeUndefined()
  })

  it('returns error when user is not admin', async () => {
    const { requireAdminAction } = await import('@/lib/auth/require-admin')
    vi.mocked(requireAdminAction).mockResolvedValueOnce({
      error: 'You are not authorized to perform this action',
      code: 'forbidden',
    })
    const { reviewFeedbackAction } = await import('./actions')
    const result = await reviewFeedbackAction('feedback-id-1', 'reviewed')

    expect(result).toMatchObject({ error: expect.any(String) })
  })

  it('returns error when service throws', async () => {
    const { updateFeedbackStatus } = await import('@/lib/services/feedback')
    vi.mocked(updateFeedbackStatus).mockRejectedValueOnce(new Error('db unavailable'))

    const { reviewFeedbackAction } = await import('./actions')
    const result = await reviewFeedbackAction('feedback-id-1', 'reviewed')

    expect(result).toEqual({ error: 'db unavailable' })
  })
})

describe('syncSentryFeedbackAction', () => {
  it('returns synced count on success', async () => {
    const { syncSentryFeedbackAction } = await import('./actions')
    const result = await syncSentryFeedbackAction()

    expect(result).toEqual({ synced: 3 })
  })

  it('returns error when sync throws', async () => {
    const { syncSentryFeedback } = await import('@/lib/services/feedback')
    vi.mocked(syncSentryFeedback).mockRejectedValueOnce(new Error('Sentry API unreachable'))

    const { syncSentryFeedbackAction } = await import('./actions')
    const result = await syncSentryFeedbackAction()

    expect(result).toEqual({ error: 'Sentry API unreachable' })
  })
})

describe('refreshHealthChecks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls checkAllServices and revalidates /admin', async () => {
    vi.mocked(checkAllServices).mockResolvedValue([
      {
        service: 'Supabase',
        status: 'healthy',
        message: 'Connected',
        checkedAt: new Date().toISOString(),
      },
    ])

    await refreshHealthChecks()

    expect(checkAllServices).toHaveBeenCalledOnce()
    expect(revalidatePath).toHaveBeenCalledWith('/admin')
  })

  it('revalidates /admin even if checkAllServices throws', async () => {
    vi.mocked(checkAllServices).mockRejectedValue(new Error('service down'))

    await expect(refreshHealthChecks()).resolves.not.toThrow()
    expect(revalidatePath).toHaveBeenCalledWith('/admin')
  })

  it('returns early for non-admin callers', async () => {
    const { requireAdminAction } = await import('@/lib/auth/require-admin')
    vi.mocked(requireAdminAction).mockResolvedValueOnce({
      error: 'You must authenticate to perform this action',
      code: 'unauthenticated',
    })

    await refreshHealthChecks()

    expect(checkAllServices).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalledWith('/admin')
  })
})

describe('setFeatureFlagAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects non-admin callers', async () => {
    const { requireAdminAction } = await import('@/lib/auth/require-admin')
    vi.mocked(requireAdminAction).mockResolvedValueOnce({
      error: 'You are not authorized to perform this action',
      code: 'forbidden',
    })

    const res = await setFeatureFlagAction('subcategory_filter_enabled', false)

    expect(res.error).toBeTruthy()
  })

  it('admin toggle writes the flag and revalidates /brands, /en/brands, /admin', async () => {
    const { setAppSetting } = await import('@/lib/services/app-settings')

    const res = await setFeatureFlagAction('subcategory_filter_enabled', false)

    expect(res.error).toBeUndefined()
    expect(setAppSetting).toHaveBeenCalledWith('subcategory_filter_enabled', false)
    expect(revalidatePath).toHaveBeenCalledWith('/brands')
    expect(revalidatePath).toHaveBeenCalledWith('/en/brands')
    expect(revalidatePath).toHaveBeenCalledWith('/admin')
    await setFeatureFlagAction('subcategory_filter_enabled', true)
  })

  it('rejects unknown flag keys', async () => {
    const res = await setFeatureFlagAction('arbitrary_key', true)

    expect(res.error).toBeTruthy()
  })
})

describe('approveClaimAction - MIT auto-verify', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls verifyMitByCert when claim has mitSmileCert', async () => {
    const { getClaimRequest } = await import('@/lib/services/claim-requests')
    const { verifyMitByCert } = await import('@/lib/services/mit-verification')

    vi.mocked(getClaimRequest).mockResolvedValue({
      id: 'claim-1',
      brandId: 'brand-1',
      userId: 'owner-1',
      proofType: 'domain_email',
      proofUrl: null,
      proofNotes: null,
      proofEvidence: [],
      mitSmileCert: '01200024-02134',
      status: 'pending',
      reviewerNotes: null,
      reviewedAt: null,
      reviewedBy: null,
      createdAt: '2026-01-01T00:00:00Z',
      brandName: 'Test Brand',
      brandSlug: 'test-brand',
      requesterEmail: 'owner@example.com',
    })
    vi.mocked(verifyMitByCert).mockResolvedValue({ data: {} })

    const { approveClaimAction } = await import('./actions')
    const result = await approveClaimAction('claim-1')

    expect(result).toBeUndefined()
    expect(verifyMitByCert).toHaveBeenCalledWith('brand-1', '01200024-02134')
  })

  it('does not call verifyMitByCert when claim has no mitSmileCert', async () => {
    const { getClaimRequest } = await import('@/lib/services/claim-requests')
    const { verifyMitByCert } = await import('@/lib/services/mit-verification')

    vi.mocked(getClaimRequest).mockResolvedValue({
      id: 'claim-1',
      brandId: 'brand-1',
      userId: 'owner-1',
      proofType: 'domain_email',
      proofUrl: null,
      proofNotes: null,
      proofEvidence: [],
      mitSmileCert: null,
      status: 'pending',
      reviewerNotes: null,
      reviewedAt: null,
      reviewedBy: null,
      createdAt: '2026-01-01T00:00:00Z',
      brandName: 'Test Brand',
      brandSlug: 'test-brand',
      requesterEmail: 'owner@example.com',
    })

    const { approveClaimAction } = await import('./actions')
    const result = await approveClaimAction('claim-1')

    expect(result).toBeUndefined()
    expect(verifyMitByCert).not.toHaveBeenCalled()
  })

  it('approval succeeds even when verifyMitByCert rejects for claim', async () => {
    const { getClaimRequest } = await import('@/lib/services/claim-requests')
    const { verifyMitByCert } = await import('@/lib/services/mit-verification')

    vi.mocked(getClaimRequest).mockResolvedValue({
      id: 'claim-1',
      brandId: 'brand-1',
      userId: 'owner-1',
      proofType: 'domain_email',
      proofUrl: null,
      proofNotes: null,
      proofEvidence: [],
      mitSmileCert: '01200024-02134',
      status: 'pending',
      reviewerNotes: null,
      reviewedAt: null,
      reviewedBy: null,
      createdAt: '2026-01-01T00:00:00Z',
      brandName: 'Test Brand',
      brandSlug: 'test-brand',
      requesterEmail: 'owner@example.com',
    })
    vi.mocked(verifyMitByCert).mockRejectedValue(new Error('Registry unavailable'))

    const { approveClaimAction } = await import('./actions')
    const result = await approveClaimAction('claim-1')

    expect(result).toBeUndefined()
    expect(verifyMitByCert).toHaveBeenCalledWith('brand-1', '01200024-02134')
  })
})
