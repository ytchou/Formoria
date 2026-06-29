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
const saveDraft = vi.fn().mockResolvedValue(undefined)
const getBrandDraft = vi.fn().mockResolvedValue(null)
const publishDraft = vi.fn().mockResolvedValue({ slug: 'test-brand' })
const discardDraft = vi.fn().mockResolvedValue({ snapshot: null })
const diffRemovedImageUrls = vi.fn((): string[] => [])
const deleteBrandImages = vi.fn().mockResolvedValue(undefined)
const cookieGet = vi.fn()
const isActingAsAdmin = vi.fn().mockResolvedValue(false)
const scanContent = vi.fn()
const shouldAutoApprove = vi.fn()
const saveModerationFlags = vi.fn().mockResolvedValue(undefined)

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

vi.mock('@/lib/auth/admin-mode', () => ({
  isActingAsAdmin,
}))

vi.mock('@/lib/services/brands', () => ({
  getBrandBySlug,
  saveDraft,
  getBrandDraft,
  publishDraft,
  discardDraft,
  updateBrand,
  diffRemovedImageUrls,
}))

vi.mock('@/lib/services/image-upload', () => ({
  deleteBrandImages,
}))

vi.mock('@/lib/services/pending-edits', () => ({
  createPendingEdit: vi.fn().mockResolvedValue({ id: 'edit-1', status: 'pending' }),
  approvePendingEdit: vi.fn().mockResolvedValue(undefined),
  hasPendingEdit: vi.fn().mockResolvedValue(false),
  getPendingEdits: vi.fn(),
  getPendingEdit: vi.fn(),
  getPendingEditCount: vi.fn(),
  rejectPendingEdit: vi.fn(),
  getLatestEditReview: vi.fn(),
  getPendingEditForReview: vi.fn(),
}))

vi.mock('@/lib/services/moderation', () => ({
  scanContent,
  shouldAutoApprove,
  saveModerationFlags,
}))

import { approvePendingEdit, createPendingEdit } from '@/lib/services/pending-edits'

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
const oldProductUrl = `${SUPA}/storage/v1/object/public/brand-images/brands/brand-1/product-old.webp`
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
    isActingAsAdmin.mockResolvedValue(true)
    getBrandBySlug.mockResolvedValue({
      id: 'brand-1',
      slug: 'test-brand',
      name: 'Test Brand',
      description: 'Original description before edit',
      socialLinks: {},
      heroImageUrl: null,
      productPhotos: [],
    })
    diffRemovedImageUrls.mockReturnValue([])
    scanContent.mockReturnValue({ riskLevel: 'clean', flags: [] })
  })

  it('updates brand', async () => {
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

  it('rejects update when user is not owner', async () => {
    const { isOwnerOf } = await import('@/lib/services/brand-owners')
    vi.mocked(isOwnerOf).mockResolvedValueOnce(false)
    isActingAsAdmin.mockResolvedValueOnce(false)

    const { updateBrandAction } = await import('./actions')

    const formData = form({
      brandSlug: 'test-brand',
      name: 'Hijacked',
    })

    const result = await updateBrandAction(undefined, formData)
    expect(result?.error).toContain('權限')
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

  it('extracts purchaseShopee flat field from FormData', async () => {
    const { updateBrandAction } = await import('./actions')

    const formData = form({
      brandSlug: 'test-brand',
      purchaseShopee: 'https://shopee.tw/example',
    })

    try {
      await updateBrandAction(undefined, formData)
    } catch {
      // redirect throws
    }

    expect(updateBrand).toHaveBeenCalledWith(
      'brand-1',
      expect.objectContaining({
        purchaseShopee: 'https://shopee.tw/example',
      })
    )
  })

  it('persists submitted image URLs', async () => {
    const { updateBrandAction } = await import('./actions')

    try {
      await updateBrandAction(undefined, form({
        brandSlug: 'test-brand',
        name: 'Acme',
        heroImageUrl: heroUrl,
        productPhotos: JSON.stringify([newProductUrl]),
      }))
    } catch {
      // redirect throws
    }

    expect(updateBrand).toHaveBeenCalledWith(
      'brand-1',
      expect.objectContaining({
        heroImageUrl: heroUrl,
        productPhotos: [newProductUrl],
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

  it('diffs and deletes orphaned hero and product images after update', async () => {
    vi.mocked(getBrandBySlug).mockResolvedValueOnce({
      id: 'brand-1',
      slug: 'test-brand',
      name: 'Test Brand',
      description: 'Original description before edit',
      socialLinks: {},
      heroImageUrl: oldHeroUrl,
      productPhotos: [oldProductUrl],
    })
    diffRemovedImageUrls.mockReturnValueOnce([oldHeroUrl, oldProductUrl])

    const { updateBrandAction } = await import('./actions')

    try {
      await updateBrandAction(undefined, form({
        brandSlug: 'test-brand',
        heroImageUrl: '',
        productPhotos: '[]',
      }))
    } catch {
      // redirect throws
    }

    expect(diffRemovedImageUrls).toHaveBeenCalledWith(
      [oldHeroUrl, oldProductUrl],
      []
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

describe('updateBrandAction — admin bypass', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ADMIN_EMAILS = 'admin@formoria.com'
    mockCookie('god')
    mockUser('owner@example.com')
    isActingAsAdmin.mockResolvedValue(true)
    getBrandBySlug.mockResolvedValue({
      id: 'brand-1',
      slug: 'test-brand',
      name: 'Test Brand',
      description: 'Original description before edit',
      socialLinks: {},
      heroImageUrl: null,
      productPhotos: [],
    })
    diffRemovedImageUrls.mockReturnValue([])
    scanContent.mockReturnValue({ riskLevel: 'clean', flags: [] })
  })

  it('lets a god-mode admin edit a brand they do not own', async () => {
    const { isOwnerOf } = await import('@/lib/services/brand-owners')
    vi.mocked(isOwnerOf).mockResolvedValueOnce(false)
    isActingAsAdmin.mockResolvedValue(true)
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

  it('forbids an admin in viewer mode from editing an un-owned brand', async () => {
    const { isOwnerOf } = await import('@/lib/services/brand-owners')
    vi.mocked(isOwnerOf).mockResolvedValueOnce(false)
    isActingAsAdmin.mockResolvedValueOnce(false)
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

describe('updateBrandAction — edit gating', () => {
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
      heroImageUrl: null,
      productPhotos: [],
    })
    diffRemovedImageUrls.mockReturnValue([])
    scanContent.mockReturnValue({ riskLevel: 'clean', flags: [] })
    shouldAutoApprove.mockResolvedValue(false)
    saveModerationFlags.mockResolvedValue(undefined)
  })

  it('auto-approves clean trusted non-admin owner edits instead of queueing them', async () => {
    isActingAsAdmin.mockResolvedValueOnce(false)
    shouldAutoApprove.mockResolvedValueOnce(true)

    const { updateBrandAction } = await import('./actions')

    try {
      await updateBrandAction(undefined, form({
        brandSlug: 'test-brand',
        name: 'Trusted Name',
        description: 'Clean trusted description',
        purchaseWebsite: 'https://example.com',
        purchaseShopee: 'https://shop.example.com/product',
      }))
    } catch {
      // redirect throws
    }

    expect(scanContent).toHaveBeenCalledWith({
      brandName: 'Trusted Name',
      fields: {
        name: 'Trusted Name',
        description: 'Clean trusted description',
        website: 'https://example.com',
        purchaseUrl: 'https://shop.example.com/product',
      },
    })
    expect(shouldAutoApprove).toHaveBeenCalledWith(
      { riskLevel: 'clean', flags: [] },
      'user-1'
    )
    expect(updateBrand).toHaveBeenCalledWith(
      'brand-1',
      expect.objectContaining({
        name: 'Trusted Name',
        description: 'Clean trusted description',
      })
    )
    expect(approvePendingEdit).not.toHaveBeenCalled()
    expect(createPendingEdit).not.toHaveBeenCalled()
  })

  it('queues flagged non-admin owner edits and saves moderation flags', async () => {
    isActingAsAdmin.mockResolvedValueOnce(false)
    const flags = [
      {
        fieldName: 'description',
        tier: 'flag',
        reason: 'Email address detected',
        flaggedContent: 'Contact owner@example.com',
      },
    ]
    scanContent.mockReturnValueOnce({ riskLevel: 'medium', flags })

    const { updateBrandAction } = await import('./actions')

    const result = await updateBrandAction(undefined, form({
      brandSlug: 'test-brand',
      name: 'Queued Name',
      description: 'Contact owner@example.com',
    }))

    expect(createPendingEdit).toHaveBeenCalledWith(
      'brand-1',
      'user-1',
      expect.objectContaining({
        name: 'Queued Name',
        description: 'Contact owner@example.com',
      })
    )
    expect(saveModerationFlags).toHaveBeenCalledWith('brand-1', 'user-1', flags)
    expect(shouldAutoApprove).not.toHaveBeenCalled()
    expect(approvePendingEdit).not.toHaveBeenCalled()
    expect(updateBrand).not.toHaveBeenCalled()
    expect(result?.message).toBe('brandEditSubmittedForReview')
  })

  it('queues clean non-admin owner edits when auto-approval is false', async () => {
    isActingAsAdmin.mockResolvedValueOnce(false)
    shouldAutoApprove.mockResolvedValueOnce(false)

    const { updateBrandAction } = await import('./actions')

    const result = await updateBrandAction(undefined, form({
      brandSlug: 'test-brand',
      name: 'Queued Name',
      description: 'Queued description',
    }))

    expect(scanContent).toHaveBeenCalledWith({
      brandName: 'Queued Name',
      fields: {
        name: 'Queued Name',
        description: 'Queued description',
        website: undefined,
        purchaseUrl: undefined,
      },
    })
    expect(shouldAutoApprove).toHaveBeenCalledWith(
      { riskLevel: 'clean', flags: [] },
      'user-1'
    )
    expect(createPendingEdit).toHaveBeenCalledWith(
      'brand-1',
      'user-1',
      expect.objectContaining({
        name: 'Queued Name',
        description: 'Queued description',
      })
    )
    expect(saveModerationFlags).not.toHaveBeenCalled()
    expect(approvePendingEdit).not.toHaveBeenCalled()
    expect(updateBrand).not.toHaveBeenCalled()
    expect(result?.message).toBe('brandEditSubmittedForReview')
  })

  it('allows admin to bypass queue and update directly', async () => {
    isActingAsAdmin.mockResolvedValue(true)

    const { updateBrandAction } = await import('./actions')

    try {
      await updateBrandAction(undefined, form({
        brandSlug: 'test-brand',
        name: 'Direct Name',
      }))
    } catch {
      // redirect throws
    }

    expect(createPendingEdit).not.toHaveBeenCalled()
    expect(updateBrand).toHaveBeenCalled()
  })

  it('blocks non-admin update immediately when scan returns high risk (tier-1 hard block)', async () => {
    isActingAsAdmin.mockResolvedValue(false)
    scanContent.mockReturnValue({ riskLevel: 'high', flags: [
      { fieldName: 'name', tier: 'block', reason: 'spam', flaggedContent: 'Buy Now Brand' },
    ] })

    const { updateBrandAction } = await import('./actions')

    const result = await updateBrandAction(undefined, form({
      brandSlug: 'test-brand',
      name: 'Buy Now Brand',
    }))

    expect(result).toEqual({ error: expect.any(String) })
    expect(updateBrand).not.toHaveBeenCalled()
    expect(createPendingEdit).not.toHaveBeenCalled()
  })
})

describe('publishDraftAction — edit gating', () => {
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
      heroImageUrl: null,
      productPhotos: [],
    })
    getBrandDraft.mockResolvedValue({
      name: 'Draft Name',
      description: 'Draft description',
    })
    diffRemovedImageUrls.mockReturnValue([])
    scanContent.mockReturnValue({ riskLevel: 'clean', flags: [] })
    shouldAutoApprove.mockResolvedValue(false)
  })

  it('routes non-admin owner to review queue instead of direct publish', async () => {
    isActingAsAdmin.mockResolvedValueOnce(false)

    const { publishDraftAction } = await import('./actions')

    const result = await publishDraftAction(undefined, form({
      brandSlug: 'test-brand',
    }))

    expect(createPendingEdit).toHaveBeenCalledWith(
      'brand-1',
      'user-1',
      expect.objectContaining({
        name: 'Draft Name',
        description: 'Draft description',
      })
    )
    expect(discardDraft).toHaveBeenCalledWith('brand-1')
    expect(publishDraft).not.toHaveBeenCalled()
    expect(result?.message).toBe('brandEditSubmittedForReview')
  })

  it('allows admin to bypass queue and publish directly', async () => {
    isActingAsAdmin.mockResolvedValue(true)

    const { publishDraftAction } = await import('./actions')

    try {
      await publishDraftAction(undefined, form({
        brandSlug: 'test-brand',
      }))
    } catch {
      // redirect throws
    }

    expect(createPendingEdit).not.toHaveBeenCalled()
    expect(publishDraft).toHaveBeenCalledWith('brand-1')
  })

  it('blocks non-admin publish immediately when draft scan returns high risk (tier-1 hard block)', async () => {
    isActingAsAdmin.mockResolvedValue(false)
    scanContent.mockReturnValue({ riskLevel: 'high', flags: [
      { fieldName: 'description', tier: 'block', reason: 'spam', flaggedContent: 'Buy Now' },
    ] })

    const { publishDraftAction } = await import('./actions')

    const result = await publishDraftAction(undefined, form({
      brandSlug: 'test-brand',
    }))

    expect(result).toEqual({ error: expect.any(String) })
    expect(publishDraft).not.toHaveBeenCalled()
    expect(createPendingEdit).not.toHaveBeenCalled()
  })
})
