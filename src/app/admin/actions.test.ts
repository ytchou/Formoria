import { revalidatePath } from 'next/cache'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { refreshHealthChecks } from './actions'
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
  getBrandById: vi.fn().mockResolvedValue({ id: 'brand-1', slug: 'test-brand' }),
  updateBrand: vi.fn().mockResolvedValue({ id: 'brand-1', slug: 'test-brand' }),
  createBrand: vi.fn(),
  deleteBrand: vi.fn(),
  generateSlug: vi.fn(),
  syncBrandImages: vi.fn().mockResolvedValue({ synced: 0, failed: 0 }),
}))

vi.mock('@/lib/services/brand-owners', () => ({
  getBrandOwnerEmail: vi.fn().mockResolvedValue('owner@example.com'),
  getUserBrandByEmail: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/services/submissions', () => ({
  getSubmission: vi.fn(),
  approveSubmission: vi.fn(),
  rejectSubmission: vi.fn(),
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

vi.mock('@/lib/services/pending-edits', () => ({
  getPendingEdit: vi.fn(),
  getPendingEditForReview: vi.fn().mockResolvedValue({
    brandId: 'brand-1',
    brandName: 'Test Brand',
  }),
  approvePendingEdit: vi.fn().mockResolvedValue(undefined),
  rejectPendingEdit: vi.fn().mockResolvedValue(undefined),
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
  buildEditApprovedEmail: vi.fn(),
  buildEditRejectedEmail: vi.fn(),
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
    expect(typeof mod.approvePendingEditAction).toBe('function')
    expect(typeof mod.rejectPendingEditAction).toBe('function')
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

describe('pending edit admin actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('approves a pending edit with the admin id', async () => {
    const { approvePendingEdit, getPendingEditForReview } = await import('@/lib/services/pending-edits')
    const { sendEmail } = await import('@/lib/email/send')
    const { buildEditApprovedEmail } = await import('@/lib/email/templates')
    const message = { to: 'owner@example.com', from: 'ops@formoria.com', subject: 'approved', html: '' }
    vi.mocked(buildEditApprovedEmail).mockResolvedValue(message)

    const { approvePendingEditAction } = await import('./actions')
    const result = await approvePendingEditAction('edit-1')

    expect(result).toBeUndefined()
    expect(getPendingEditForReview).toHaveBeenCalledWith('edit-1')
    expect(approvePendingEdit).toHaveBeenCalledWith('edit-1', 'admin-1')
    expect(buildEditApprovedEmail).toHaveBeenCalledWith({
      brandName: 'Test Brand',
      ownerEmail: 'owner@example.com',
      locale: 'zh-TW',
    })
    expect(sendEmail).toHaveBeenCalledWith(message)
  })

  it('approvePendingEditAction calls markFlagsReviewed with brandId', async () => {
    const { markFlagsReviewed } = await import('@/lib/services/moderation')

    const { approvePendingEditAction } = await import('./actions')
    const result = await approvePendingEditAction('edit-1')

    expect(result).toBeUndefined()
    expect(markFlagsReviewed).toHaveBeenCalledWith('brand-1')
  })

  it('rejects a pending edit with the admin id and notes', async () => {
    const { rejectPendingEdit, getPendingEditForReview } = await import('@/lib/services/pending-edits')
    const { sendEmail } = await import('@/lib/email/send')
    const { buildEditRejectedEmail } = await import('@/lib/email/templates')
    const message = { to: 'owner@example.com', from: 'ops@formoria.com', subject: 'rejected', html: '' }
    vi.mocked(buildEditRejectedEmail).mockResolvedValue(message)

    const { rejectPendingEditAction } = await import('./actions')
    const result = await rejectPendingEditAction('edit-1', 'Please add clearer product details')

    expect(result).toBeUndefined()
    expect(getPendingEditForReview).toHaveBeenCalledWith('edit-1')
    expect(rejectPendingEdit).toHaveBeenCalledWith('edit-1', 'admin-1', 'Please add clearer product details')
    expect(buildEditRejectedEmail).toHaveBeenCalledWith({
      brandName: 'Test Brand',
      ownerEmail: 'owner@example.com',
      notes: 'Please add clearer product details',
      locale: 'zh-TW',
    })
    expect(sendEmail).toHaveBeenCalledWith(message)
  })
})

describe('pending edit email templates', () => {
  it('builds an approved email with the brand name in the subject and html', async () => {
    const { buildEditApprovedEmail } =
      await vi.importActual<typeof import('@/lib/email/templates')>('@/lib/email/templates')

    const email = await buildEditApprovedEmail('Formosa Bikes', 'owner@example.com')

    expect(email.to).toBe('owner@example.com')
    expect(email.subject).toContain('Formosa Bikes')
    expect(email.html).toContain('Formosa Bikes')
  })

  it('builds a rejected email with reviewer notes in the html', async () => {
    const { buildEditRejectedEmail } =
      await vi.importActual<typeof import('@/lib/email/templates')>('@/lib/email/templates')

    const email = await buildEditRejectedEmail('Formosa Bikes', 'owner@example.com', 'Please clarify factory location')

    expect(email.html).toContain('Please clarify factory location')
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
    expect(approveSubmission).toHaveBeenCalledWith('sub-1', 'admin-1', undefined)
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

  it('updateBrandAction (admin edit) calls scanContent and saveModerationFlags when flags exist, then markFlagsReviewed', async () => {
    const { updateBrand } = await import('@/lib/services/brands')
    const { scanContent, saveModerationFlags, markFlagsReviewed } = await import('@/lib/services/moderation')
    const flags = [
      { type: 'profanity', severity: 'medium', field: 'description', value: 'bad word' },
    ] as unknown as ReturnType<typeof scanContent>['flags']
    vi.mocked(scanContent).mockReturnValue({ riskLevel: 'medium', flags })

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
    expect(scanContent).toHaveBeenCalledWith({
      fields: {
        name: 'Test Brand',
        description: 'bad word',
        website: undefined,
        purchaseUrl: undefined,
      },
      brandName: 'Test Brand',
    })
    expect(saveModerationFlags).toHaveBeenCalledWith('brand-1', 'admin-1', flags)
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

describe('reviewFeedbackAction', () => {
  it('calls updateFeedbackStatus and revalidates /admin/signals/feedback', async () => {
    const { reviewFeedbackAction } = await import('./actions')
    const { updateFeedbackStatus } = await import('@/lib/services/feedback')

    const result = await reviewFeedbackAction('feedback-id-1', 'reviewed')

    expect(updateFeedbackStatus).toHaveBeenCalledWith('feedback-id-1', 'reviewed')
    expect(revalidatePath).toHaveBeenCalledWith('/admin/signals/feedback')
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

describe('approveSubmissionAction - MIT auto-verify', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls verifyMitByCert when overrides include mitSmileCert', async () => {
    const { approveSubmission } = await import('@/lib/services/submissions')
    const { getBrandById } = await import('@/lib/services/brands')
    const { verifyMitByCert } = await import('@/lib/services/mit-verification')

    vi.mocked(approveSubmission).mockResolvedValue({
      brandId: 'brand-1',
      submitterEmail: 'submitter@example.com',
      brandName: 'Test Brand',
      submitterName: null,
      isBrandOwner: false,
    })
    vi.mocked(getBrandById).mockResolvedValue({ id: 'brand-1', slug: 'test-brand', heroImageUrl: null } as Awaited<ReturnType<typeof getBrandById>>)
    vi.mocked(verifyMitByCert).mockResolvedValue({ data: {} })

    const { approveSubmissionAction } = await import('./actions')
    const result = await approveSubmissionAction('sub-1', { mitSmileCert: '01200024-02134' })

    expect(result).toBeUndefined()
    expect(verifyMitByCert).toHaveBeenCalledWith('brand-1', '01200024-02134')
  })

  it('does not call verifyMitByCert when overrides have no mitSmileCert', async () => {
    const { approveSubmission } = await import('@/lib/services/submissions')
    const { getBrandById } = await import('@/lib/services/brands')
    const { verifyMitByCert } = await import('@/lib/services/mit-verification')

    vi.mocked(approveSubmission).mockResolvedValue({
      brandId: 'brand-1',
      submitterEmail: 'submitter@example.com',
      brandName: 'Test Brand',
      submitterName: null,
      isBrandOwner: false,
    })
    vi.mocked(getBrandById).mockResolvedValue({ id: 'brand-1', slug: 'test-brand', heroImageUrl: null } as Awaited<ReturnType<typeof getBrandById>>)

    const { approveSubmissionAction } = await import('./actions')
    const result = await approveSubmissionAction('sub-1')

    expect(result).toBeUndefined()
    expect(verifyMitByCert).not.toHaveBeenCalled()
  })

  it('approval succeeds even when verifyMitByCert rejects', async () => {
    const { approveSubmission } = await import('@/lib/services/submissions')
    const { getBrandById } = await import('@/lib/services/brands')
    const { verifyMitByCert } = await import('@/lib/services/mit-verification')

    vi.mocked(approveSubmission).mockResolvedValue({
      brandId: 'brand-1',
      submitterEmail: 'submitter@example.com',
      brandName: 'Test Brand',
      submitterName: null,
      isBrandOwner: false,
    })
    vi.mocked(getBrandById).mockResolvedValue({ id: 'brand-1', slug: 'test-brand', heroImageUrl: null } as Awaited<ReturnType<typeof getBrandById>>)
    vi.mocked(verifyMitByCert).mockRejectedValue(new Error('Registry unavailable'))

    const { approveSubmissionAction } = await import('./actions')
    const result = await approveSubmissionAction('sub-1', { mitSmileCert: '01200024-02134' })

    expect(result).toBeUndefined()
    expect(verifyMitByCert).toHaveBeenCalledWith('brand-1', '01200024-02134')
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
