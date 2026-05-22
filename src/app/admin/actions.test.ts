import { describe, it, expect, vi } from 'vitest'

// Mocks must be at top-level for vitest hoisting
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'admin-1', email: 'admin@mitmap.tw' } },
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
  updateBrand: vi.fn().mockResolvedValue({ id: 'brand-1', slug: 'test-brand' }),
  createBrand: vi.fn(),
  deleteBrand: vi.fn(),
  generateSlug: vi.fn(),
  syncBrandImages: vi.fn(),
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
}))

vi.mock('@/lib/services/moderation', () => ({
  updateFlagStatus: vi.fn().mockResolvedValue(undefined),
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
    expect(typeof mod.createTagAction).toBe('function')
    expect(typeof mod.renameTagAction).toBe('function')
    expect(typeof mod.mergeTagAction).toBe('function')
    expect(typeof mod.deactivateTagAction).toBe('function')
    expect(typeof mod.reviewFlagAction).toBe('function')
  })
})

describe('revertFlagAction', () => {
  it('revertFlagAction is exported', async () => {
    const mod = await import('./actions')
    expect(typeof mod.revertFlagAction).toBe('function')
  })

  it('returns stale error when flag has no previous_content', async () => {
    const { createServiceClient } = await import('@/lib/supabase/server')
    const mockSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'flag-1',
        brand_id: 'brand-1',
        field_name: 'description',
        flagged_content: 'SPAM',
        previous_content: null, // no previous content
      },
      error: null,
    })
    vi.mocked(createServiceClient).mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ single: mockSingle }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      }),
    } as any)

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
