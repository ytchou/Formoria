import { describe, it, expect, vi, beforeEach } from 'vitest'

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
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    })),
  })),
  createServiceClient: vi.fn(() => ({
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
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

vi.mock('@/lib/services/brands', () => ({
  getBrandBySlug: vi.fn(),
  getBrandById: vi.fn().mockResolvedValue({ id: 'brand-1', slug: 'test-brand' }),
  updateBrand: vi.fn().mockResolvedValue({ id: 'brand-1', slug: 'test-brand' }),
  createBrand: vi.fn(),
  deleteBrand: vi.fn(),
  generateSlug: vi.fn(),
  syncBrandImages: vi.fn().mockResolvedValue({ synced: 0, failed: 0 }),
}))

vi.mock('@/lib/services/submissions', () => ({
  getSubmission: vi.fn(),
  approveSubmission: vi.fn(),
  rejectSubmission: vi.fn(),
}))

vi.mock('@/lib/services/taxonomy', () => ({
  createTag: vi.fn(),
  updateTag: vi.fn(),
  mergeTag: vi.fn(),
  deactivateTag: vi.fn(),
  setBrandTags: vi.fn().mockResolvedValue(undefined),
  getBrandsForReview: vi.fn().mockResolvedValue([]),
  processSuggestedTag: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/services/moderation', () => ({
  getModerationFlag: vi.fn(),
  updateFlagStatus: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/services/reports', () => ({
  updateReportStatus: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/email/resend-adapter', () => ({
  createResendProvider: vi.fn(() => ({ send: vi.fn() })),
}))

vi.mock('@/lib/email/templates', () => ({
  buildApprovalEmail: vi.fn(),
  buildRejectionEmail: vi.fn(),
  buildClaimEmail: vi.fn(),
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
    expect(typeof mod.resyncBrandImagesAction).toBe('function')
    expect(typeof mod.createTagAction).toBe('function')
    expect(typeof mod.renameTagAction).toBe('function')
    expect(typeof mod.mergeTagAction).toBe('function')
    expect(typeof mod.deactivateTagAction).toBe('function')
    expect(typeof mod.reviewFlagAction).toBe('function')
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
    expect(revalidatePath).toHaveBeenCalledWith('/admin/brands')
    expect(result).toEqual({ synced: 2, failed: 1 })
  })
})

describe('revertFlagAction', () => {
  it('revertFlagAction is exported', async () => {
    const mod = await import('./actions')
    expect(typeof mod.revertFlagAction).toBe('function')
  })

  it('returns stale error when flag has no previous_content', async () => {
    const { getModerationFlag } = await import('@/lib/services/moderation')
    vi.mocked(getModerationFlag).mockResolvedValue({
      id: 'flag-1',
      brandId: 'brand-1',
      brandName: null,
      brandSlug: null,
      userId: 'user-1',
      fieldName: 'description',
      flaggedContent: 'SPAM',
      previousContent: null,
      flagReason: 'test',
      tier: 'flag',
      status: 'pending',
      reviewedAt: null,
      createdAt: '2026-01-01T00:00:00Z',
    })

    const { revertFlagAction } = await import('./actions')
    const result = await revertFlagAction('flag-1')
    expect(result).toEqual({ error: 'stale' })
  })
})

describe('bulkUpdateFlagsAction', () => {
  it('bulkUpdateFlagsAction is exported', async () => {
    const mod = await import('./actions')
    expect(typeof mod.bulkUpdateFlagsAction).toBe('function')
  })

  it('reviews all specified flag IDs', async () => {
    const { updateFlagStatus } = await import('@/lib/services/moderation')
    vi.mocked(updateFlagStatus).mockResolvedValue(undefined)

    const { bulkUpdateFlagsAction } = await import('./actions')
    const result = await bulkUpdateFlagsAction(['flag-1', 'flag-2'], 'reviewed')
    expect(result).toEqual({ updated: 2, errors: [] })
    expect(updateFlagStatus).toHaveBeenCalledTimes(2)
  })

  it('reports individual failures without aborting the rest', async () => {
    const { updateFlagStatus } = await import('@/lib/services/moderation')
    vi.mocked(updateFlagStatus)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('DB error'))

    const { bulkUpdateFlagsAction } = await import('./actions')
    const result = await bulkUpdateFlagsAction(['flag-1', 'flag-2'], 'reviewed')
    expect(result.updated).toBe(1)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].id).toBe('flag-2')
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

    expect(setBrandTags).toHaveBeenCalledWith('brand-123', ['tag-1', 'tag-2'], 'manual')
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

    expect(setBrandTags).toHaveBeenCalledWith('brand-123', ['tag-1'], 'manual')
    expect(result).toEqual({ success: true })
  })
})

describe('processSuggestedTagAction', () => {
  it('calls processSuggestedTag with correct params for reject', async () => {
    const { processSuggestedTag } = await import('@/lib/services/taxonomy')
    vi.mocked(processSuggestedTag).mockResolvedValue(undefined)

    const { processSuggestedTagAction } = await import('./actions')
    const formData = new FormData()
    formData.append('submissionId', 'sub-123')
    formData.append('action', 'reject')

    const result = await processSuggestedTagAction(formData)

    expect(processSuggestedTag).toHaveBeenCalledWith('sub-123', 'reject', undefined, undefined)
    expect(result).toEqual({ success: true })
  })

  it('passes targetTagId for map-existing action', async () => {
    const { processSuggestedTag } = await import('@/lib/services/taxonomy')
    vi.mocked(processSuggestedTag).mockResolvedValue(undefined)

    const { processSuggestedTagAction } = await import('./actions')
    const formData = new FormData()
    formData.append('submissionId', 'sub-123')
    formData.append('action', 'map-existing')
    formData.append('targetTagId', 'tag-456')

    const result = await processSuggestedTagAction(formData)

    expect(processSuggestedTag).toHaveBeenCalledWith('sub-123', 'map-existing', 'tag-456', undefined)
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
