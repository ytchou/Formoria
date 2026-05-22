import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRevalidatePath = vi.fn()

vi.mock('next/cache', () => ({
  revalidatePath: mockRevalidatePath,
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'admin-user-id', email: 'admin@test.com' } },
        error: null,
      }),
    },
  })),
  createServiceClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      update: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
    })),
  })),
}))

vi.mock('@/lib/auth/admin', () => ({
  isAdmin: vi.fn().mockReturnValue(true),
}))

vi.mock('@/lib/services/submissions', () => ({
  getSubmission: vi.fn().mockResolvedValue({
    id: 'sub-1',
    brandId: 'brand-1',
    brandName: 'Test Brand',
    description: 'Test',
    submitterEmail: 'user@test.com',
    socialLinks: {},
    isBrandOwner: false,
  }),
  approveSubmission: vi.fn().mockResolvedValue(undefined),
  rejectSubmission: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/services/brands', () => ({
  createBrand: vi.fn().mockResolvedValue({ id: 'brand-1', slug: 'test-brand' }),
  updateBrand: vi.fn().mockResolvedValue({ id: 'brand-1', slug: 'test-brand' }),
  deleteBrand: vi.fn().mockResolvedValue(undefined),
  generateSlug: vi.fn().mockReturnValue('test-brand'),
  syncBrandImages: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/services/taxonomy', () => ({
  createTag: vi.fn(),
  updateTag: vi.fn(),
  mergeTag: vi.fn(),
  deactivateTag: vi.fn(),
}))

vi.mock('@/lib/email/resend-adapter', () => ({
  createResendProvider: vi.fn(() => ({
    send: vi.fn().mockResolvedValue(undefined),
  })),
}))

vi.mock('@/lib/email/templates', () => ({
  buildApprovalEmail: vi.fn().mockReturnValue({}),
  buildRejectionEmail: vi.fn().mockReturnValue({}),
  buildClaimEmail: vi.fn().mockReturnValue({}),
}))

vi.mock('@/lib/auth/claim-token', () => ({
  generateClaimToken: vi.fn().mockResolvedValue('claim-token-123'),
}))

vi.mock('@/lib/services/moderation', () => ({
  updateFlagStatus: vi.fn(),
}))

const {
  approveSubmissionAction,
  rejectSubmissionAction,
  updateBrandAction,
  hideBrandAction,
  unhideBrandAction,
  deleteBrandAction,
} = await import('./actions')

describe('admin actions cache invalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('approveSubmissionAction revalidates public brand pages', async () => {
    await approveSubmissionAction('sub-1')

    expect(mockRevalidatePath).toHaveBeenCalledWith('/')
    expect(mockRevalidatePath).toHaveBeenCalledWith('/brands')
  })

  it('rejectSubmissionAction revalidates public brand pages', async () => {
    await rejectSubmissionAction('sub-1', 'not good')

    expect(mockRevalidatePath).toHaveBeenCalledWith('/')
    expect(mockRevalidatePath).toHaveBeenCalledWith('/brands')
  })

  it('updateBrandAction revalidates public brand pages', async () => {
    await updateBrandAction('brand-1', { status: 'approved' })

    expect(mockRevalidatePath).toHaveBeenCalledWith('/')
    expect(mockRevalidatePath).toHaveBeenCalledWith('/brands')
  })

  it('hideBrandAction revalidates public brand pages', async () => {
    await hideBrandAction('brand-1')

    expect(mockRevalidatePath).toHaveBeenCalledWith('/')
    expect(mockRevalidatePath).toHaveBeenCalledWith('/brands')
  })

  it('unhideBrandAction revalidates public brand pages', async () => {
    await unhideBrandAction('brand-1')

    expect(mockRevalidatePath).toHaveBeenCalledWith('/')
    expect(mockRevalidatePath).toHaveBeenCalledWith('/brands')
  })

  it('deleteBrandAction revalidates public brand pages', async () => {
    await deleteBrandAction('brand-1')

    expect(mockRevalidatePath).toHaveBeenCalledWith('/')
    expect(mockRevalidatePath).toHaveBeenCalledWith('/brands')
  })
})
