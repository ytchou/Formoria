import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'user-1', email: 'owner@example.com' } },
      }),
    },
  })),
  createServiceClient: vi.fn(() => ({
    from: vi.fn().mockReturnValue({
      insert: vi.fn().mockResolvedValue({ error: null }),
    }),
  })),
}))

vi.mock('@/lib/services/brand-owners', () => ({
  isOwnerOf: vi.fn().mockResolvedValue(true),
}))

vi.mock('@/lib/services/brands', () => ({
  getBrandBySlug: vi.fn().mockResolvedValue({
    id: 'brand-1',
    slug: 'test-brand',
    name: 'Test Brand',
    socialLinks: {},
  }),
  updateBrand: vi.fn().mockResolvedValue({ slug: 'test-brand' }),
}))

vi.mock('@/lib/services/moderation', () => ({
  checkContent: vi.fn().mockReturnValue({
    blocked: [],
    flagged: [],
    isBlocked: false,
  }),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT')
  }),
}))

describe('updateBrandAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('updates brand when content passes moderation', async () => {
    const { updateBrandAction } = await import('./actions')
    const { updateBrand } = await import('@/lib/services/brands')

    const formData = new FormData()
    formData.set('brandSlug', 'test-brand')
    formData.set('name', 'Updated Name')
    formData.set('description', 'A nice description')

    try {
      await updateBrandAction(undefined, formData)
    } catch {
      // redirect throws
    }

    expect(updateBrand).toHaveBeenCalled()
  })

  it('rejects update when content is blocked (Tier 1)', async () => {
    const { checkContent } = await import('@/lib/services/moderation')
    vi.mocked(checkContent).mockReturnValueOnce({
      blocked: [{ field: 'description', reason: 'spam detected' }],
      flagged: [],
      isBlocked: true,
    })

    const { updateBrandAction } = await import('./actions')

    const formData = new FormData()
    formData.set('brandSlug', 'test-brand')
    formData.set('description', 'Buy cheap viagra')

    const result = await updateBrandAction(undefined, formData)

    expect(result?.fieldErrors?.description).toBeTruthy()
  })

  it('saves but creates flag for Tier 2 content', async () => {
    const { checkContent } = await import('@/lib/services/moderation')
    vi.mocked(checkContent).mockReturnValueOnce({
      blocked: [],
      flagged: [{ field: 'description', content: 'many urls', reason: 'excessive URLs', tier: 'flag' as const }],
      isBlocked: false,
    })

    const { updateBrandAction } = await import('./actions')
    const { updateBrand } = await import('@/lib/services/brands')

    const formData = new FormData()
    formData.set('brandSlug', 'test-brand')
    formData.set('description', 'Visit http://a.com http://b.com http://c.com http://d.com')

    try {
      await updateBrandAction(undefined, formData)
    } catch {
      // redirect throws
    }

    expect(updateBrand).toHaveBeenCalled()
  })

  it('rejects update when user is not owner', async () => {
    const { isOwnerOf } = await import('@/lib/services/brand-owners')
    vi.mocked(isOwnerOf).mockResolvedValueOnce(false)

    const { updateBrandAction } = await import('./actions')

    const formData = new FormData()
    formData.set('brandSlug', 'test-brand')
    formData.set('name', 'Hijacked')

    const result = await updateBrandAction(undefined, formData)
    expect(result?.error).toContain('權限')
  })
})

describe('expanded field moderation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('checks websiteUrl for moderation', async () => {
    const { checkContent } = await import('@/lib/services/moderation')
    vi.mocked(checkContent).mockReturnValueOnce({
      blocked: [],
      flagged: [{ field: 'websiteUrl', content: 'https://brand.tk', reason: 'suspicious TLD', tier: 'flag' as const }],
      isBlocked: false,
    })

    const { updateBrandAction } = await import('./actions')

    const formData = new FormData()
    formData.set('brandSlug', 'test-brand')
    formData.set('websiteUrl', 'https://brand.tk')

    try {
      await updateBrandAction(undefined, formData)
    } catch {
      // redirect throws
    }

    expect(checkContent).toHaveBeenCalledWith(
      expect.objectContaining({ websiteUrl: 'https://brand.tk' })
    )
    // Assert: update proceeded (not blocked)
    const { updateBrand } = await import('@/lib/services/brands')
    expect(updateBrand).toHaveBeenCalled()
  })

  it('extracts foundingYear from FormData', async () => {
    const { updateBrandAction } = await import('./actions')
    const { updateBrand } = await import('@/lib/services/brands')

    const formData = new FormData()
    formData.set('brandSlug', 'test-brand')
    formData.set('foundingYear', '2020')

    try {
      await updateBrandAction(undefined, formData)
    } catch {
      // redirect throws
    }

    expect(updateBrand).toHaveBeenCalledWith(
      'brand-1',
      expect.objectContaining({ foundingYear: 2020 })
    )
  })

  it('extracts purchaseLinks array from FormData', async () => {
    const { updateBrandAction } = await import('./actions')
    const { updateBrand } = await import('@/lib/services/brands')

    const formData = new FormData()
    formData.set('brandSlug', 'test-brand')
    formData.set('purchaseLinks[0].platform', 'shopee')
    formData.set('purchaseLinks[0].url', 'https://shopee.tw/example')
    formData.set('purchaseLinks[0].label', 'Buy on Shopee')

    try {
      await updateBrandAction(undefined, formData)
    } catch {
      // redirect throws
    }

    expect(updateBrand).toHaveBeenCalledWith(
      'brand-1',
      expect.objectContaining({
        purchaseLinks: [{ platform: 'shopee', url: 'https://shopee.tw/example', label: 'Buy on Shopee' }],
      })
    )
  })

  it('includes previous_content when inserting flags', async () => {
    const { getBrandBySlug } = await import('@/lib/services/brands')
    vi.mocked(getBrandBySlug).mockResolvedValueOnce({
      id: 'brand-123',
      slug: 'test-brand',
      name: 'Test Brand',
      description: 'Original description before edit',
      socialLinks: {},
    } as unknown as Awaited<ReturnType<typeof getBrandBySlug>>)

    const { checkContent } = await import('@/lib/services/moderation')
    vi.mocked(checkContent).mockReturnValueOnce({
      blocked: [],
      flagged: [{ field: 'description', content: 'SPAMMY CONTENT', reason: 'test', tier: 'flag' as const }],
      isBlocked: false,
    })

    // Capture the insert call
    const mockInsert = vi.fn().mockResolvedValue({ error: null })
    const { createServiceClient } = await import('@/lib/supabase/server')
    vi.mocked(createServiceClient).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        insert: mockInsert,
      }),
    } as unknown as ReturnType<typeof createServiceClient>)

    const { updateBrandAction } = await import('./actions')

    const formData = new FormData()
    formData.set('brandSlug', 'test-brand')
    formData.set('description', 'SPAMMY CONTENT')

    try {
      await updateBrandAction(undefined, formData)
    } catch {
      // redirect throws
    }

    expect(mockInsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          field_name: 'description',
          flagged_content: 'SPAMMY CONTENT',
          previous_content: 'Original description before edit',
        }),
      ])
    )
  })
})
