import { describe, it, expect, vi, beforeEach } from 'vitest'
import zhMessages from '../../../../../../../messages/zh-TW.json'

function makeT(messages: Record<string, unknown>, namespace: string) {
  return (key: string) => {
    const parts = `${namespace}.${key}`.split('.')
    let current: unknown = messages
    for (const part of parts) {
      if (typeof current !== 'object' || current === null) return key
      current = (current as Record<string, unknown>)[part]
    }
    return typeof current === 'string' ? current : key
  }
}

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn().mockImplementation(async (namespace: string) =>
    makeT(zhMessages as unknown as Record<string, unknown>, namespace)
  ),
}))

const getUser = vi.fn().mockResolvedValue({
  data: { user: { id: 'user-1', email: 'owner@example.com' } },
})
const updateBrand = vi.fn().mockResolvedValue({ slug: 'test-brand' })
const getBrandBySlug = vi.fn()
const checkContent = vi.fn()
const createModerationFlags = vi.fn().mockResolvedValue([])
const diffRemovedImageUrls = vi.fn((): string[] => [])
const deleteBrandImages = vi.fn().mockResolvedValue(undefined)
const cookieGet = vi.fn()

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: cookieGet,
  })),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser,
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
  getBrandBySlug,
  updateBrand,
}))

vi.mock('@/lib/services/moderation', () => ({
  checkContent,
  createModerationFlags,
}))

vi.mock('@/lib/services/image-upload', () => ({
  diffRemovedImageUrls,
  deleteBrandImages,
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT')
  }),
}))

const SUPA = 'https://abc.supabase.co'
const heroUrl = `${SUPA}/storage/v1/object/public/brand-images/brands/brand-1/hero-new.webp`
const oldHeroUrl = `${SUPA}/storage/v1/object/public/brand-images/brands/brand-1/hero-old.webp`
const oldLogoUrl = `${SUPA}/storage/v1/object/public/brand-images/brands/brand-1/logo-old.webp`
const oldProductUrl = `${SUPA}/storage/v1/object/public/brand-images/brands/brand-1/product-old.webp`
const newLogoUrl = `${SUPA}/storage/v1/object/public/brand-images/brands/brand-1/logo-new.webp`
const newProductUrl = `${SUPA}/storage/v1/object/public/brand-images/brands/brand-1/product-new.webp`

function form(fields: Record<string, string>) {
  const formData = new FormData()
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value)
  }
  return formData
}

function mockCookie(value: 'god' | 'viewer') {
  cookieGet.mockImplementation((name: string) => (
    name === 'fm_mode' ? { value } : undefined
  ))
}

function mockUser(email: string, id = 'user-1') {
  getUser.mockResolvedValue({
    data: { user: { id, email } },
  })
}

describe('updateBrandAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ADMIN_EMAILS = 'admin@formoria.com'
    mockCookie('god')
    mockUser('owner@example.com')
    getBrandBySlug.mockResolvedValue({
      id: 'brand-1',
      slug: 'test-brand',
      name: 'Test Brand',
      description: 'Original description before edit',
      socialLinks: {},
      logoUrl: null,
      heroImageUrl: null,
      productPhotos: [],
      brandHighlights: null,
    })
    checkContent.mockReturnValue({
      blocked: [],
      flagged: [],
      isBlocked: false,
    })
    diffRemovedImageUrls.mockReturnValue([])
  })

  it('updates brand when content passes moderation', async () => {
    const { updateBrandAction } = await import('./actions')

    const formData = form({
      brandSlug: 'test-brand',
      name: 'Updated Name',
      description: 'A nice description',
    })

    try {
      await updateBrandAction(undefined, formData)
    } catch {
      // redirect throws
    }

    expect(updateBrand).toHaveBeenCalled()
  })

  it('rejects update when content is blocked (Tier 1)', async () => {
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
    vi.mocked(checkContent).mockReturnValueOnce({
      blocked: [],
      flagged: [{ field: 'description', content: 'many urls', reason: 'excessive URLs', tier: 'flag' as const }],
      isBlocked: false,
    })

    const { updateBrandAction } = await import('./actions')

    const formData = form({
      brandSlug: 'test-brand',
      description: 'Visit http://a.com http://b.com http://c.com http://d.com',
    })

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

    const formData = form({
      brandSlug: 'test-brand',
      name: 'Hijacked',
    })

    const result = await updateBrandAction(undefined, formData)
    expect(result?.error).toContain('權限')
  })

  it('checks websiteUrl for moderation', async () => {
    vi.mocked(checkContent).mockReturnValueOnce({
      blocked: [],
      flagged: [{ field: 'websiteUrl', content: 'https://brand.tk', reason: 'suspicious TLD', tier: 'flag' as const }],
      isBlocked: false,
    })

    const { updateBrandAction } = await import('./actions')

    const formData = form({
      brandSlug: 'test-brand',
      websiteUrl: 'https://brand.tk',
    })

    try {
      await updateBrandAction(undefined, formData)
    } catch {
      // redirect throws
    }

    expect(checkContent).toHaveBeenCalledWith(
      expect.objectContaining({ websiteUrl: 'https://brand.tk' })
    )
    expect(updateBrand).toHaveBeenCalled()
  })

  it('extracts foundingYear from FormData', async () => {
    const { updateBrandAction } = await import('./actions')

    const formData = form({
      brandSlug: 'test-brand',
      foundingYear: '2020',
    })

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

    const formData = form({
      brandSlug: 'test-brand',
      'purchaseLinks[0].platform': 'shopee',
      'purchaseLinks[0].url': 'https://shopee.tw/example',
      'purchaseLinks[0].label': 'Buy on Shopee',
    })

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
    vi.mocked(getBrandBySlug).mockResolvedValueOnce({
      id: 'brand-123',
      slug: 'test-brand',
      name: 'Test Brand',
      description: 'Original description before edit',
      logoUrl: null,
      heroImageUrl: null,
      productPhotos: [],
      brandHighlights: null,
      socialLinks: {},
    })

    vi.mocked(checkContent).mockReturnValueOnce({
      blocked: [],
      flagged: [{ field: 'description', content: 'SPAMMY CONTENT', reason: 'test', tier: 'flag' as const }],
      isBlocked: false,
    })

    const { updateBrandAction } = await import('./actions')

    const formData = form({
      brandSlug: 'test-brand',
      description: 'SPAMMY CONTENT',
    })

    try {
      await updateBrandAction(undefined, formData)
    } catch {
      // redirect throws
    }

    expect(createModerationFlags).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          fieldName: 'description',
          flaggedContent: 'SPAMMY CONTENT',
          previousContent: 'Original description before edit',
        }),
      ])
    )
  })

  it('persists submitted image URLs and brandHighlights', async () => {
    const { updateBrandAction } = await import('./actions')

    try {
      await updateBrandAction(undefined, form({
        brandSlug: 'test-brand',
        name: 'Acme',
        logoUrl: newLogoUrl,
        heroImageUrl: heroUrl,
        productPhotos: JSON.stringify([newProductUrl]),
        brandHighlights: 'Hand-finished in Taichung',
      }))
    } catch {
      // redirect throws
    }

    expect(updateBrand).toHaveBeenCalledWith(
      'brand-1',
      expect.objectContaining({
        logoUrl: newLogoUrl,
        heroImageUrl: heroUrl,
        productPhotos: [newProductUrl],
        brandHighlights: 'Hand-finished in Taichung',
      })
    )
  })

  it('caps submitted productPhotos to the first 6 entries', async () => {
    const { updateBrandAction } = await import('./actions')
    const productPhotos = Array.from({ length: 8 }, (_, index) => `${SUPA}/product-${index + 1}.webp`)

    try {
      await updateBrandAction(undefined, form({
        brandSlug: 'test-brand',
        productPhotos: JSON.stringify(productPhotos),
      }))
    } catch {
      // redirect throws
    }

    expect(updateBrand).toHaveBeenCalledWith(
      'brand-1',
      expect.objectContaining({
        productPhotos: productPhotos.slice(0, 6),
      })
    )
  })

  it('does not let governed fields reach updateBrand', async () => {
    const { updateBrandAction } = await import('./actions')

    try {
      await updateBrandAction(undefined, form({
        brandSlug: 'test-brand',
        name: 'Acme',
        category: 'hacked',
        tags: '["x"]',
        badges: '["trusted"]',
        status: 'approved',
        mit_status: 'approved',
        is_demo: 'true',
        source: 'admin',
        founderName: 'bad write',
      }))
    } catch {
      // redirect throws
    }

    const arg = updateBrand.mock.calls[0]?.[1] ?? {}
    expect(arg).not.toHaveProperty('category')
    expect(arg).not.toHaveProperty('tags')
    expect(arg).not.toHaveProperty('badges')
    expect(arg).not.toHaveProperty('status')
    expect(arg).not.toHaveProperty('mit_status')
    expect(arg).not.toHaveProperty('is_demo')
    expect(arg).not.toHaveProperty('source')
    expect(arg).not.toHaveProperty('founderName')
  })

  it('blocks save when brandHighlights hits Tier 1 moderation', async () => {
    vi.mocked(checkContent).mockReturnValueOnce({
      blocked: [{ field: 'brandHighlights', reason: 'blocked highlight' }],
      flagged: [],
      isBlocked: true,
    })

    const { updateBrandAction } = await import('./actions')

    const result = await updateBrandAction(undefined, form({
      brandSlug: 'test-brand',
      name: 'Acme',
      brandHighlights: '<banned phrase>',
    }))

    expect(updateBrand).not.toHaveBeenCalled()
    expect(result?.fieldErrors?.brandHighlights).toBe('blocked highlight')
  })

  it('returns an error when productPhotos is malformed JSON', async () => {
    const { updateBrandAction } = await import('./actions')

    const result = await updateBrandAction(undefined, form({
      brandSlug: 'test-brand',
      productPhotos: '{"bad"',
    }))

    expect(updateBrand).not.toHaveBeenCalled()
    expect(result?.error).toContain('productPhotos')
  })

  it('diffs and deletes orphaned brand images after update', async () => {
    vi.mocked(getBrandBySlug).mockResolvedValueOnce({
      id: 'brand-1',
      slug: 'test-brand',
      name: 'Test Brand',
      description: 'Original description before edit',
      socialLinks: {},
      logoUrl: oldLogoUrl,
      heroImageUrl: oldHeroUrl,
      productPhotos: [oldProductUrl],
      brandHighlights: null,
    })
    diffRemovedImageUrls.mockReturnValueOnce([oldHeroUrl, oldProductUrl])

    const { updateBrandAction } = await import('./actions')

    try {
      await updateBrandAction(undefined, form({
        brandSlug: 'test-brand',
        logoUrl: newLogoUrl,
        heroImageUrl: '',
        productPhotos: '[]',
      }))
    } catch {
      // redirect throws
    }

    expect(diffRemovedImageUrls).toHaveBeenCalledWith(
      [oldLogoUrl, oldHeroUrl, oldProductUrl],
      [newLogoUrl]
    )
    expect(deleteBrandImages).toHaveBeenCalledWith([oldHeroUrl, oldProductUrl])
  })

  it('revalidates the locale-prefixed public brand page', async () => {
    const { revalidatePath } = await import('next/cache')
    const { updateBrandAction } = await import('./actions')

    try {
      await updateBrandAction(undefined, form({
        brandSlug: 'test-brand',
        name: 'Acme',
      }))
    } catch {
      // redirect throws
    }

    expect(revalidatePath).toHaveBeenCalledWith('/[locale]/brands/[slug]', 'page')
  })
})

describe('updateBrandAction — admin bypass + moderation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ADMIN_EMAILS = 'admin@formoria.com'
    mockCookie('god')
    mockUser('owner@example.com')
    getBrandBySlug.mockResolvedValue({
      id: 'brand-1',
      slug: 'test-brand',
      name: 'Test Brand',
      description: 'Original description before edit',
      socialLinks: {},
      logoUrl: null,
      heroImageUrl: null,
      productPhotos: [],
      brandHighlights: null,
    })
    checkContent.mockReturnValue({
      blocked: [],
      flagged: [],
      isBlocked: false,
    })
    diffRemovedImageUrls.mockReturnValue([])
  })

  it('lets a god-mode admin edit a brand they do not own', async () => {
    const { isOwnerOf } = await import('@/lib/services/brand-owners')
    vi.mocked(isOwnerOf).mockResolvedValueOnce(false)
    mockCookie('god')
    mockUser('admin@formoria.com', 'admin-1')

    const { updateBrandAction } = await import('./actions')

    try {
      await updateBrandAction(undefined, form({
        brandSlug: 'test-brand',
        description: 'Admin description edit',
      }))
    } catch {
      // redirect throws
    }

    expect(updateBrand).toHaveBeenCalled()
  })

  it('auto-resolves moderation flags for god-mode admin edits', async () => {
    const { isOwnerOf } = await import('@/lib/services/brand-owners')
    vi.mocked(isOwnerOf).mockResolvedValueOnce(false)
    mockCookie('god')
    mockUser('admin@formoria.com', 'admin-1')
    vi.mocked(checkContent).mockReturnValueOnce({
      blocked: [],
      flagged: [{ field: 'description', content: 'many urls', reason: 'excessive URLs', tier: 'flag' as const }],
      isBlocked: false,
    })

    const { updateBrandAction } = await import('./actions')

    try {
      await updateBrandAction(undefined, form({
        brandSlug: 'test-brand',
        description: 'Visit http://a.com http://b.com http://c.com http://d.com',
      }))
    } catch {
      // redirect throws
    }

    expect(createModerationFlags).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          status: 'reviewed',
          reviewedAt: expect.any(String),
          flagReason: expect.stringContaining('admin-edit'),
        }),
      ])
    )
  })

  it('keeps pending flags for a real owner edit', async () => {
    const { isOwnerOf } = await import('@/lib/services/brand-owners')
    vi.mocked(isOwnerOf).mockResolvedValueOnce(true)
    mockCookie('god')
    mockUser('owner@example.com')
    vi.mocked(checkContent).mockReturnValueOnce({
      blocked: [],
      flagged: [{ field: 'description', content: 'many urls', reason: 'excessive URLs', tier: 'flag' as const }],
      isBlocked: false,
    })

    const { updateBrandAction } = await import('./actions')

    try {
      await updateBrandAction(undefined, form({
        brandSlug: 'test-brand',
        description: 'Visit http://a.com http://b.com http://c.com http://d.com',
      }))
    } catch {
      // redirect throws
    }

    expect(createModerationFlags).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          status: 'pending',
          flagReason: 'excessive URLs',
        }),
      ])
    )
  })

  it('forbids an admin in viewer mode from editing an un-owned brand', async () => {
    const { isOwnerOf } = await import('@/lib/services/brand-owners')
    vi.mocked(isOwnerOf).mockResolvedValueOnce(false)
    mockCookie('viewer')
    mockUser('admin@formoria.com', 'admin-1')

    const { updateBrandAction } = await import('./actions')

    const result = await updateBrandAction(undefined, form({
      brandSlug: 'test-brand',
      description: 'Viewer mode edit',
    }))

    expect(result).toMatchObject({ error: expect.any(String) })
    expect(updateBrand).not.toHaveBeenCalled()
  })
})
