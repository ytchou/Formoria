import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'

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

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
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
  verifyMitStatus: vi.fn().mockResolvedValue({ id: 'brand-1', name: 'Test Brand' }),
  rejectMitStatus: vi.fn().mockResolvedValue({ id: 'brand-1', name: 'Test Brand' }),
}))

vi.mock('@/lib/services/taxonomy', () => ({
  createTag: vi.fn(),
  updateTag: vi.fn(),
  mergeTag: vi.fn(),
  deactivateTag: vi.fn(),
  setBrandTags: vi.fn().mockResolvedValue(undefined),
  getBrandsForReview: vi.fn().mockResolvedValue([]),
  getTagBySlug: vi.fn(),
  addTagToBrand: vi.fn(),
}))

vi.mock('@/lib/services/reports', () => ({
  updateReportStatus: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/services/feedback', () => ({
  updateFeedbackStatus: vi.fn().mockResolvedValue(undefined),
  syncSentryFeedback: vi.fn().mockResolvedValue({ synced: 3, errors: 0 }),
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
  buildMitVerificationSubmittedEmail: vi.fn(),
  buildMitVerificationApprovedEmail: vi.fn(),
  buildMitVerificationNeedsDocsEmail: vi.fn(),
}))

vi.mock('@/lib/services/email-lifecycle', () => ({
  createEmailPreferences: vi.fn().mockResolvedValue({ data: {}, error: null }),
}))

vi.mock('@/lib/auth/claim-token', () => ({
  generateClaimToken: vi.fn(),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

const mockCookie = (value?: string | null) =>
  (cookies as Mock).mockResolvedValue({
    get: (name: string) => (name === 'fm_mode' && value ? { value } : undefined),
  })

beforeEach(() => {
  mockCookie('god')
})

describe('admin actions module', () => {
  it('exports all required action functions', async () => {
    const mod = await import('./actions')

    expect(typeof mod.approveSubmissionAction).toBe('function')
    expect(typeof mod.rejectSubmissionAction).toBe('function')
    expect(typeof mod.updateBrandAction).toBe('function')
    expect(typeof mod.hideBrandAction).toBe('function')
    expect(typeof mod.unhideBrandAction).toBe('function')
    expect(typeof mod.deleteBrandAction).toBe('function')
    expect(typeof mod.resyncBrandImagesAction).toBe('function')
    expect(typeof mod.createTagAction).toBe('function')
    expect(typeof mod.renameTagAction).toBe('function')
    expect(typeof mod.mergeTagAction).toBe('function')
    expect(typeof mod.deactivateTagAction).toBe('function')
    expect(typeof mod.acknowledgeMitVerificationSubmissionAction).toBe('function')
    expect(typeof mod.approvePendingEditAction).toBe('function')
    expect(typeof mod.rejectPendingEditAction).toBe('function')
  })
})

describe('approveClaimAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCookie('god')
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
})

describe('pending edit admin actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCookie('god')
  })

  it('approves a pending edit with the admin id', async () => {
    const { approvePendingEdit, getPendingEditForReview } = await import('@/lib/services/pending-edits')
    const { sendEmail } = await import('@/lib/email/send')
    const { buildEditApprovedEmail } = await import('@/lib/email/templates')
    const message = { to: 'owner@example.com', from: 'ops@formoria.com', subject: 'approved', html: '' }
    vi.mocked(buildEditApprovedEmail).mockReturnValue(message)

    const { approvePendingEditAction } = await import('./actions')
    const result = await approvePendingEditAction('edit-1')

    expect(result).toBeUndefined()
    expect(getPendingEditForReview).toHaveBeenCalledWith('edit-1')
    expect(approvePendingEdit).toHaveBeenCalledWith('edit-1', 'admin-1')
    expect(buildEditApprovedEmail).toHaveBeenCalledWith('Test Brand', 'owner@example.com')
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
    vi.mocked(buildEditRejectedEmail).mockReturnValue(message)

    const { rejectPendingEditAction } = await import('./actions')
    const result = await rejectPendingEditAction('edit-1', 'Please add clearer product details')

    expect(result).toBeUndefined()
    expect(getPendingEditForReview).toHaveBeenCalledWith('edit-1')
    expect(rejectPendingEdit).toHaveBeenCalledWith('edit-1', 'admin-1', 'Please add clearer product details')
    expect(buildEditRejectedEmail).toHaveBeenCalledWith('Test Brand', 'owner@example.com', 'Please add clearer product details')
    expect(sendEmail).toHaveBeenCalledWith(message)
  })
})

describe('pending edit email templates', () => {
  it('builds an approved email with the brand name in the subject and html', async () => {
    const { buildEditApprovedEmail } =
      await vi.importActual<typeof import('@/lib/email/templates')>('@/lib/email/templates')

    const email = buildEditApprovedEmail('Formosa Bikes', 'owner@example.com')

    expect(email.to).toBe('owner@example.com')
    expect(email.subject).toContain('Formosa Bikes')
    expect(email.html).toContain('Formosa Bikes')
  })

  it('builds a rejected email with reviewer notes in the html', async () => {
    const { buildEditRejectedEmail } =
      await vi.importActual<typeof import('@/lib/email/templates')>('@/lib/email/templates')

    const email = buildEditRejectedEmail('Formosa Bikes', 'owner@example.com', 'Please clarify factory location')

    expect(email.html).toContain('Please clarify factory location')
  })
})

describe('approveSubmissionAction - taxonomy tag application', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCookie('god')
  })

  it('applies structured region + value tags on approval', async () => {
    const { getSubmission, approveSubmission } = await import('@/lib/services/submissions')
    const { updateBrand } = await import('@/lib/services/brands')
    const { getTagBySlug, addTagToBrand } = await import('@/lib/services/taxonomy')
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
      suggestedTags: { region: 'north-taiwan', values: ['eco-friendly', 'handmade'] },
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
    vi.mocked(approveSubmission).mockResolvedValue(submission)
    vi.mocked(getTagBySlug).mockImplementation(async (slug: string) => ({ id: `tag-${slug}`, slug }) as unknown as Awaited<ReturnType<typeof getTagBySlug>>)
    vi.mocked(addTagToBrand).mockResolvedValue(undefined)

    const { approveSubmissionAction } = await import('./actions')
    const result = await approveSubmissionAction('sub-1')

    expect(result).toBeUndefined()
    expect(addTagToBrand).toHaveBeenCalledTimes(3)
    expect(addTagToBrand).toHaveBeenCalledWith('brand-1', 'tag-north-taiwan')
    expect(addTagToBrand).toHaveBeenCalledWith('brand-1', 'tag-eco-friendly')
    expect(addTagToBrand).toHaveBeenCalledWith('brand-1', 'tag-handmade')
  })

  it('skips old string[] suggestedTags gracefully', async () => {
    const { getSubmission, approveSubmission } = await import('@/lib/services/submissions')
    const { updateBrand } = await import('@/lib/services/brands')
    const { addTagToBrand } = await import('@/lib/services/taxonomy')
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
      suggestedTags: ['eco-friendly', 'handmade'],
      status: 'pending',
      reviewerNotes: null,
      submittedAt: '2026-01-01T00:00:00Z',
      reviewedAt: null,
      reviewedBy: null,
      pdpaConsentAt: null,
      validationStatus: null,
      validationErrors: null,
      notifiedAt: null,
    } as Awaited<ReturnType<typeof getSubmission>>
    vi.mocked(getSubmission).mockResolvedValue(submission)
    vi.mocked(updateBrand).mockResolvedValue({ id: 'brand-1', slug: 'test-brand' } as Awaited<ReturnType<typeof updateBrand>>)
    vi.mocked(approveSubmission).mockResolvedValue(submission)
    vi.mocked(addTagToBrand).mockResolvedValue(undefined)

    const { approveSubmissionAction } = await import('./actions')
    const result = await approveSubmissionAction('sub-1')

    expect(result).toBeUndefined()
    expect(addTagToBrand).not.toHaveBeenCalled()
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
    vi.mocked(approveSubmission).mockResolvedValue(submission)

    const { approveSubmissionAction } = await import('./actions')
    const result = await approveSubmissionAction('sub-1')

    expect(result).toBeUndefined()
    expect(markFlagsReviewed).toHaveBeenCalledWith('brand-1')
  })
})

describe('updateBrandAction moderation audit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCookie('god')
  })

  it('updateBrandAction (god-mode admin edit) calls scanContent and saveModerationFlags when flags exist, then markFlagsReviewed', async () => {
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
        brandHighlights: undefined,
        website: undefined,
        purchaseUrl: undefined,
      },
      brandName: 'Test Brand',
    })
    expect(saveModerationFlags).toHaveBeenCalledWith('brand-1', 'admin-1', flags)
    expect(markFlagsReviewed).toHaveBeenCalledWith('brand-1')
  })
})

describe('MIT verification email actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCookie('god')
  })

  it('sends submitted email when MIT verification submission is acknowledged', async () => {
    const { getBrandById } = await import('@/lib/services/brands')
    const { sendEmail } = await import('@/lib/email/send')
    const { buildMitVerificationSubmittedEmail } = await import('@/lib/email/templates')
    const message = { to: 'owner@example.com', from: 'ops@formoria.com', subject: 'submitted', html: '' }
    vi.mocked(getBrandById).mockResolvedValue({ id: 'brand-1', name: 'Test Brand' } as Awaited<ReturnType<typeof getBrandById>>)
    vi.mocked(buildMitVerificationSubmittedEmail).mockReturnValue(message)

    const { acknowledgeMitVerificationSubmissionAction } = await import('./actions')
    const result = await acknowledgeMitVerificationSubmissionAction('brand-1')

    expect(result).toEqual({ success: true })
    expect(buildMitVerificationSubmittedEmail).toHaveBeenCalledWith({
      to: 'owner@example.com',
      brandName: 'Test Brand',
    })
    expect(sendEmail).toHaveBeenCalledWith(message)
  })

  it('sends approved email after MIT verification is approved', async () => {
    const { verifyMitStatus } = await import('@/lib/services/mit-verification')
    const { sendEmail } = await import('@/lib/email/send')
    const { buildMitVerificationApprovedEmail } = await import('@/lib/email/templates')
    const message = { to: 'owner@example.com', from: 'ops@formoria.com', subject: 'approved', html: '' }
    vi.mocked(verifyMitStatus).mockResolvedValue({ id: 'brand-1', name: 'Test Brand' } as Awaited<ReturnType<typeof verifyMitStatus>>)
    vi.mocked(buildMitVerificationApprovedEmail).mockReturnValue(message)

    const { verifyMitAction } = await import('./actions')
    const result = await verifyMitAction('brand-1', '01200024-02134')

    expect(result).toBeUndefined()
    expect(buildMitVerificationApprovedEmail).toHaveBeenCalledWith({
      to: 'owner@example.com',
      brandName: 'Test Brand',
    })
    expect(sendEmail).toHaveBeenCalledWith(message)
  })

  it('sends needs-docs email after MIT verification is rejected', async () => {
    const { rejectMitStatus } = await import('@/lib/services/mit-verification')
    const { sendEmail } = await import('@/lib/email/send')
    const { buildMitVerificationNeedsDocsEmail } = await import('@/lib/email/templates')
    const message = { to: 'owner@example.com', from: 'ops@formoria.com', subject: 'needs docs', html: '' }
    vi.mocked(rejectMitStatus).mockResolvedValue({ id: 'brand-1', name: 'Test Brand' } as Awaited<ReturnType<typeof rejectMitStatus>>)
    vi.mocked(buildMitVerificationNeedsDocsEmail).mockReturnValue(message)

    const { rejectMitAction } = await import('./actions')
    const result = await rejectMitAction('brand-1', 'Please upload factory docs')

    expect(result).toBeUndefined()
    expect(buildMitVerificationNeedsDocsEmail).toHaveBeenCalledWith({
      to: 'owner@example.com',
      brandName: 'Test Brand',
      notes: 'Please upload factory docs',
    })
    expect(sendEmail).toHaveBeenCalledWith(message)
  })
})

describe('resyncBrandImagesAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns sync counts and revalidates admin brands', async () => {
    const { getBrandById, syncBrandImages } = await import('@/lib/services/brands')
    const { revalidatePath } = await import('next/cache')
    vi.mocked(getBrandById).mockResolvedValue({ id: 'brand-1', slug: 'test-brand' } as Awaited<ReturnType<typeof getBrandById>>)
    vi.mocked(syncBrandImages).mockResolvedValue({ synced: 2, failed: 1 })

    const { resyncBrandImagesAction } = await import('./actions')
    const result = await resyncBrandImagesAction('brand-1')

    expect(syncBrandImages).toHaveBeenCalledWith('brand-1')
    expect(revalidatePath).toHaveBeenCalledWith('/admin/catalog/brands')
    expect(result).toEqual({ synced: 2, failed: 1 })
  })
})

describe('setBrandTagsAction', () => {
  it('calls setBrandTags with manual source', async () => {
    const { setBrandTags } = await import('@/lib/services/taxonomy')
    vi.mocked(setBrandTags).mockResolvedValue(undefined)

    const { setBrandTagsAction } = await import('./actions')
    const formData = new FormData()
    formData.append('brandId', 'brand-123')
    formData.append('tagIds', JSON.stringify(['tag-1', 'tag-2']))

    const result = await setBrandTagsAction(formData)

    expect(setBrandTags).toHaveBeenCalledWith('brand-123', ['tag-1', 'tag-2'])
    expect(result).toEqual({ success: true })
  })

  it('returns error when brandId is missing', async () => {
    const { setBrandTagsAction } = await import('./actions')
    const formData = new FormData()
    formData.append('tagIds', JSON.stringify(['tag-1']))

    const result = await setBrandTagsAction(formData)

    expect(result).toHaveProperty('error')
  })
})

describe('confirmBrandTagsAction', () => {
  it('calls setBrandTags to upgrade source from auto to manual', async () => {
    const { setBrandTags } = await import('@/lib/services/taxonomy')
    vi.mocked(setBrandTags).mockResolvedValue(undefined)

    const { confirmBrandTagsAction } = await import('./actions')
    const formData = new FormData()
    formData.append('brandId', 'brand-123')
    formData.append('tagIds', JSON.stringify(['tag-1']))

    const result = await confirmBrandTagsAction(formData)

    expect(setBrandTags).toHaveBeenCalledWith('brand-123', ['tag-1'])
    expect(result).toEqual({ success: true })
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
    const { isAdmin } = await import('@/lib/auth/admin')
    vi.mocked(isAdmin).mockReturnValueOnce(false)
    const { reviewReportAction } = await import('./actions')
    const result = await reviewReportAction('report-uuid-1', 'reviewed')
    expect(result?.error).toBeTruthy()
  })

  it('requireAdmin denies an admin in viewer mode', async () => {
    mockCookie('viewer')
    const { reviewReportAction } = await import('./actions')
    const result = await reviewReportAction('report-uuid-1', 'reviewed')
    expect(result).toMatchObject({ error: expect.any(String) })
  })
})

describe('bulkUpdateReportsAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns updated count on success', async () => {
    const { updateReportStatus } = await import('@/lib/services/reports')
    vi.mocked(updateReportStatus).mockResolvedValue(undefined)

    const { bulkUpdateReportsAction } = await import('./actions')
    const result = await bulkUpdateReportsAction(['r1', 'r2'], 'dismissed')
    expect(result.updated).toBe(2)
    expect(result.errors).toHaveLength(0)
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
    const { isAdmin } = await import('@/lib/auth/admin')
    vi.mocked(isAdmin).mockReturnValueOnce(false)
    const { reviewFeedbackAction } = await import('./actions')
    const result = await reviewFeedbackAction('feedback-id-1', 'reviewed')

    expect(result).toEqual({ error: expect.any(String) })
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
