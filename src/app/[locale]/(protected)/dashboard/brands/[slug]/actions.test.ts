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
  getLocale: vi.fn().mockResolvedValue('zh-TW'),
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
const isActingAsAdmin = vi.fn().mockResolvedValue(false)
const getImpersonatedBrandSlug = vi.fn().mockResolvedValue('test-brand')
const scanContent = vi.fn()
const saveModerationFlags = vi.fn().mockResolvedValue(undefined)
const buildViolationAdminNotificationEmail = vi.fn()
const sendEmail = vi.fn().mockResolvedValue({ success: true })
const isOnboardingStepKey = vi.fn().mockReturnValue(true)
const setBrandOnboardingStepStatus = vi.fn().mockResolvedValue(undefined)
const declareMit = vi.fn().mockResolvedValue({ ok: true })
const withdrawDeclaration = vi.fn().mockResolvedValue({ ok: true })
const trackMitDeclared = vi.fn()
const rejectBrandImages = vi.fn().mockResolvedValue(undefined)
const mergeDraftOverBrand = vi.fn((brand: Record<string, unknown>, snapshot: Record<string, unknown>) => ({
  ...brand,
  ...snapshot,
  name: 'Test Brand',
  productType: 'food',
  description: 'A complete profile',
  productTags: ['tea'],
  priceRange: 2,
  heroImageUrl: heroUrl,
  productPhotos: [newProductUrl],
  purchaseWebsite: 'https://example.com',
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
vi.mock('@/lib/auth/impersonation', () => ({
  getImpersonatedBrandSlug,
}))

vi.mock('@/lib/services/brands', () => ({
  getBrandBySlug,
  saveDraft,
  getBrandDraft,
  publishDraft,
  discardDraft,
  updateBrand,
  diffRemovedImageUrls,
  mergeDraftOverBrand,
}))

vi.mock('@/lib/services/brand-images', () => ({
  insertBrandImage: vi.fn().mockResolvedValue(undefined),
  rejectBrandImages,
  syncHeroDenormalized: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/services/image-upload', () => ({
  deleteBrandImages,
}))

vi.mock('@/lib/services/moderation', () => ({
  scanContent,
  saveModerationFlags,
}))

vi.mock('@/lib/email/templates', () => ({
  buildViolationAdminNotificationEmail,
}))

vi.mock('@/lib/email/send', () => ({
  sendEmail,
}))

vi.mock('@/lib/services/brand-onboarding', () => ({
  isOnboardingStepKey,
  setBrandOnboardingStepStatus,
}))

vi.mock('@/lib/services/mit-declaration', () => ({
  declareMit,
  withdrawDeclaration,
}))

vi.mock('@/lib/analytics', () => ({
  trackMitDeclared,
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
const oldProductUrl = `${SUPA}/storage/v1/object/public/brand-images/brands/brand-1/product-old.webp`
const newProductUrl = `${SUPA}/storage/v1/object/public/brand-images/brands/brand-1/product-new.webp`

function form(fields: Record<string, string>) {
  const formData = new FormData()
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value)
  }
  return formData
}

function physicalLocationFields(
  index: number,
  overrides: Partial<{
    name: string
    kind: string
    relationshipType: string
    type: string
    address: string
    city: string
    district: string
    venueName: string
    floorOrCounter: string
    availabilityNote: string
    latitude: string
    longitude: string
    verificationStatus: string
    confirmationStatus: string
    retailerUrl: string
  }> = {},
): Record<string, string> {
  const values = {
    name: '台北旗艦店',
    kind: 'location',
    relationshipType: 'brand_store',
    type: '',
    address: '台北市信義區市府路 45 號',
    city: 'taipei',
    district: '信義區',
    venueName: '',
    floorOrCounter: '',
    availabilityNote: '',
    latitude: '',
    longitude: '',
    verificationStatus: 'manual',
    confirmationStatus: 'owner_confirmed',
    retailerUrl: '',
    ...overrides,
  }
  const prefix = `retailLocations[${index}]`

  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [`${prefix}.${key}`, value]),
  )
}

const confirmedTaipeiLocation = {
  kind: 'location' as const,
  name: '台北旗艦店',
  relationshipType: 'brand_store' as const,
  address: '台北市信義區市府路 45 號',
  city: 'taipei',
  district: '信義區',
  verificationStatus: 'manual' as const,
  confirmationStatus: 'owner_confirmed' as const,
}

function mockUser(email: string, id = 'user-1') {
  getUser.mockResolvedValue({
    data: { user: { id, email } },
  })
}

beforeEach(() => {
  getImpersonatedBrandSlug.mockResolvedValue('test-brand')
})

describe('declareMitAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUser('owner@example.com')
    getBrandBySlug.mockResolvedValue({
      id: 'brand-1',
      slug: 'test-brand',
      name: 'Test Brand',
    })
  })

  it('rejects users who cannot edit the brand', async () => {
    const { isOwnerOf } = await import('@/lib/services/brand-owners')
    vi.mocked(isOwnerOf).mockResolvedValueOnce(false)
    isActingAsAdmin.mockResolvedValueOnce(false)

    const { declareMitAction } = await import('./actions')
    const result = await declareMitAction('test-brand', 'most')

    expect(result.error).toContain('權限')
    expect(declareMit).not.toHaveBeenCalled()
  })
})

describe('updateBrandAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ADMIN_EMAILS = 'admin@formoria.com'
    mockUser('owner@example.com')
    isActingAsAdmin.mockResolvedValue(true)
    getImpersonatedBrandSlug.mockResolvedValue('test-brand')
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
    scanContent.mockReturnValue({ violations: [] })
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

  it('updates the public product category', async () => {
    const { updateBrandAction } = await import('./actions')

    const formData = form({
      brandSlug: 'test-brand',
      name: 'Updated Name',
      productType: 'home',
    })

    try {
      await updateBrandAction(undefined, formData)
    } catch {
      // redirect throws
    }

    expect(updateBrand).toHaveBeenCalledWith(
      'brand-1',
      expect.objectContaining({ productType: 'home' })
    )
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

  it('extracts mitStory from FormData', async () => {
    const { parseBrandEditForm } = await import('./actions-utils')

    const formData = form({
      brandSlug: 'test-brand',
      name: 'Updated Name',
      description: 'A nice description',
      mitStory: 'Handcrafted in New Taipei since 1985.',
    })

    const result = parseBrandEditForm(formData)

    expect(result.mitStory).toBe('Handcrafted in New Taipei since 1985.')
  })

  it('sets mitStory to null when field is empty string', async () => {
    const { parseBrandEditForm } = await import('./actions-utils')

    const formData = form({
      brandSlug: 'test-brand',
      name: 'Updated Name',
      description: 'A nice description',
      mitStory: '',
    })

    const result = parseBrandEditForm(formData)

    expect(result.mitStory).toBeNull()
  })

  it('extracts and trims romanizedName from FormData', async () => {
    const { parseBrandEditForm } = await import('./actions-utils')
    const result = parseBrandEditForm(form({
      brandSlug: 'test-brand',
      romanizedName: '  Warmwood Living  ',
    }))

    expect(result.romanizedName).toBe('Warmwood Living')
  })

  it('preserves an explicit romanizedName clear as null', async () => {
    const { parseBrandEditForm } = await import('./actions-utils')
    const result = parseBrandEditForm(form({
      brandSlug: 'test-brand',
      romanizedName: '',
    }))

    expect(result.romanizedName).toBeNull()
  })

  it('persists an empty retailLocations array when submitted rows normalize away', async () => {
    const { parseBrandEditForm } = await import('./actions-utils')

    const formData = form({
      brandSlug: 'test-brand',
      'retailLocations[0].name': '',
      'retailLocations[0].relationshipType': 'stockist',
      'retailLocations[0].address': '',
      'retailLocations[0].city': '',
      'retailLocations[0].district': '',
      'retailLocations[0].venueName': '',
      'retailLocations[0].floorOrCounter': '',
      'retailLocations[0].availabilityNote': '',
      'retailLocations[0].latitude': '',
      'retailLocations[0].longitude': '',
      'retailLocations[0].verificationStatus': 'manual',
    })

    expect(parseBrandEditForm(formData).retailLocations).toEqual([])
  })

  it('normalizes legacy retail location type input to a canonical record', async () => {
    const { parseBrandEditForm } = await import('./actions-utils')

    const formData = form({
      brandSlug: 'test-brand',
      'retailLocations[0].name': '台北京站時尚廣場',
      'retailLocations[0].relationshipType': 'stockist',
      'retailLocations[0].type': 'independent',
      'retailLocations[0].address': '台北市大同區承德路一段 1 號',
      'retailLocations[0].city': 'taipei',
      'retailLocations[0].district': '大同區',
      'retailLocations[0].venueName': '台北京站時尚廣場',
      'retailLocations[0].floorOrCounter': '',
      'retailLocations[0].availabilityNote': '',
      'retailLocations[0].latitude': '25.049',
      'retailLocations[0].longitude': '121.517',
      'retailLocations[0].verificationStatus': 'verified',
    })

    expect(parseBrandEditForm(formData).retailLocations).toEqual([
      expect.objectContaining({
        kind: 'location',
        name: '台北京站時尚廣場',
      }),
    ])
    expect(parseBrandEditForm(formData).retailLocations?.[0]).not.toHaveProperty(
      'type',
    )
  })

  it('parses canonical retail chain fields including retailerUrl', async () => {
    const { parseBrandEditForm } = await import('./actions-utils')

    const result = parseBrandEditForm(
      form({
        brandSlug: 'test-brand',
        'retailLocations[0].name': '誠品生活',
        'retailLocations[0].kind': 'retail_chain',
        'retailLocations[0].retailerUrl': 'https://www.eslite.com/',
        'retailLocations[0].confirmationStatus': 'owner_confirmed',
      }),
    )

    expect(result.retailLocations).toEqual([
      {
        kind: 'retail_chain',
        name: '誠品生活',
        retailerUrl: 'https://www.eslite.com/',
        availabilityNote: undefined,
      },
    ])
  })

  it('does not add retailLocations when the form omits the field', async () => {
    const { parseBrandEditForm } = await import('./actions-utils')

    expect(parseBrandEditForm(form({ brandSlug: 'test-brand' }))).not.toHaveProperty(
      'retailLocations',
    )
  })

  it('allows an owner to newly confirm an addressed location', async () => {
    const { isOwnerOf } = await import('@/lib/services/brand-owners')
    vi.mocked(isOwnerOf).mockResolvedValueOnce(true)
    isActingAsAdmin.mockResolvedValue(false)
    getBrandBySlug.mockResolvedValue({
      id: 'brand-1',
      slug: 'test-brand',
      name: 'Test Brand',
      description: 'Original description before edit',
      socialLinks: {},
      heroImageUrl: null,
      productPhotos: [],
      retailLocations: [],
    })

    const { updateBrandAction } = await import('./actions')
    await expect(
      updateBrandAction(
        undefined,
        form({ brandSlug: 'test-brand', ...physicalLocationFields(0) }),
      ),
    ).rejects.toThrow('NEXT_REDIRECT')

    expect(updateBrand).toHaveBeenCalledWith(
      'brand-1',
      expect.objectContaining({
        retailLocations: [
          expect.objectContaining({ confirmationStatus: 'owner_confirmed' }),
        ],
      }),
    )
  })

  it('prevents an admin from newly confirming a location', async () => {
    const { isOwnerOf } = await import('@/lib/services/brand-owners')
    vi.mocked(isOwnerOf).mockResolvedValueOnce(false)
    isActingAsAdmin.mockResolvedValue(true)
    mockUser('admin@formoria.com', 'admin-1')
    getBrandBySlug.mockResolvedValue({
      id: 'brand-1',
      slug: 'test-brand',
      name: 'Test Brand',
      description: 'Original description before edit',
      socialLinks: {},
      heroImageUrl: null,
      productPhotos: [],
      retailLocations: [],
    })

    const { updateBrandAction } = await import('./actions')
    await expect(
      updateBrandAction(
        undefined,
        form({ brandSlug: 'test-brand', ...physicalLocationFields(0) }),
      ),
    ).rejects.toThrow('NEXT_REDIRECT')

    expect(updateBrand).toHaveBeenCalledWith(
      'brand-1',
      expect.objectContaining({
        retailLocations: [
          expect.objectContaining({ confirmationStatus: 'unconfirmed' }),
        ],
      }),
    )
  })

  it('preserves an unchanged owner-confirmed location during an admin edit', async () => {
    const { isOwnerOf } = await import('@/lib/services/brand-owners')
    vi.mocked(isOwnerOf).mockResolvedValueOnce(false)
    isActingAsAdmin.mockResolvedValue(true)
    mockUser('admin@formoria.com', 'admin-1')
    getBrandBySlug.mockResolvedValue({
      id: 'brand-1',
      slug: 'test-brand',
      name: 'Test Brand',
      description: 'Original description before edit',
      socialLinks: {},
      heroImageUrl: null,
      productPhotos: [],
      retailLocations: [confirmedTaipeiLocation],
    })

    const { updateBrandAction } = await import('./actions')
    await expect(
      updateBrandAction(
        undefined,
        form({
          brandSlug: 'test-brand',
          ...physicalLocationFields(0, {
            availabilityNote: '週一至週五有貨',
          }),
        }),
      ),
    ).rejects.toThrow('NEXT_REDIRECT')

    expect(updateBrand).toHaveBeenCalledWith(
      'brand-1',
      expect.objectContaining({
        retailLocations: [
          expect.objectContaining({
            confirmationStatus: 'owner_confirmed',
            availabilityNote: '週一至週五有貨',
          }),
        ],
      }),
    )
  })

  it('resets confirmation when an admin edits location identity', async () => {
    const { isOwnerOf } = await import('@/lib/services/brand-owners')
    vi.mocked(isOwnerOf).mockResolvedValueOnce(false)
    isActingAsAdmin.mockResolvedValue(true)
    mockUser('admin@formoria.com', 'admin-1')
    getBrandBySlug.mockResolvedValue({
      id: 'brand-1',
      slug: 'test-brand',
      name: 'Test Brand',
      description: 'Original description before edit',
      socialLinks: {},
      heroImageUrl: null,
      productPhotos: [],
      retailLocations: [confirmedTaipeiLocation],
    })

    const { updateBrandAction } = await import('./actions')
    await expect(
      updateBrandAction(
        undefined,
        form({
          brandSlug: 'test-brand',
          ...physicalLocationFields(0, {
            address: '台北市信義區松壽路 11 號',
          }),
        }),
      ),
    ).rejects.toThrow('NEXT_REDIRECT')

    expect(updateBrand).toHaveBeenCalledWith(
      'brand-1',
      expect.objectContaining({
        retailLocations: [
          expect.objectContaining({ confirmationStatus: 'unconfirmed' }),
        ],
      }),
    )
  })

  it('preserves confirmations when an admin only reorders locations', async () => {
    const secondLocation = {
      ...confirmedTaipeiLocation,
      name: '台中旗艦店',
      address: '台中市西屯區台灣大道三段 251 號',
      city: 'taichung',
      district: '西屯區',
    }
    const { isOwnerOf } = await import('@/lib/services/brand-owners')
    vi.mocked(isOwnerOf).mockResolvedValueOnce(false)
    isActingAsAdmin.mockResolvedValue(true)
    mockUser('admin@formoria.com', 'admin-1')
    getBrandBySlug.mockResolvedValue({
      id: 'brand-1',
      slug: 'test-brand',
      name: 'Test Brand',
      description: 'Original description before edit',
      socialLinks: {},
      heroImageUrl: null,
      productPhotos: [],
      retailLocations: [confirmedTaipeiLocation, secondLocation],
    })

    const { updateBrandAction } = await import('./actions')
    await expect(
      updateBrandAction(
        undefined,
        form({
          brandSlug: 'test-brand',
          ...physicalLocationFields(0, {
            name: secondLocation.name,
            address: secondLocation.address,
            city: secondLocation.city,
            district: secondLocation.district,
          }),
          ...physicalLocationFields(1),
        }),
      ),
    ).rejects.toThrow('NEXT_REDIRECT')

    expect(updateBrand).toHaveBeenCalledWith(
      'brand-1',
      expect.objectContaining({
        retailLocations: [
          expect.objectContaining({
            name: secondLocation.name,
            confirmationStatus: 'owner_confirmed',
          }),
          expect.objectContaining({
            name: confirmedTaipeiLocation.name,
            confirmationStatus: 'owner_confirmed',
          }),
        ],
      }),
    )
  })

  it('blocks duplicate retailLocations when parsing owner edits', async () => {
    const { InvalidBrandEditFormError, parseBrandEditForm } = await import(
      './actions-utils'
    )

    const formData = form({
      brandSlug: 'test-brand',
      'retailLocations[0].name': 'First location',
      'retailLocations[0].relationshipType': 'stockist',
      'retailLocations[0].address': 'Taipei 101',
      'retailLocations[0].city': '',
      'retailLocations[0].district': '',
      'retailLocations[0].venueName': '',
      'retailLocations[0].floorOrCounter': '',
      'retailLocations[0].availabilityNote': '',
      'retailLocations[0].latitude': '',
      'retailLocations[0].longitude': '',
      'retailLocations[0].verificationStatus': 'manual',
      'retailLocations[1].name': 'Second location',
      'retailLocations[1].relationshipType': 'brand_store',
      'retailLocations[1].address': ' Taipei   101 ',
      'retailLocations[1].city': '',
      'retailLocations[1].district': '',
      'retailLocations[1].venueName': '',
      'retailLocations[1].floorOrCounter': '',
      'retailLocations[1].availabilityNote': '',
      'retailLocations[1].latitude': '',
      'retailLocations[1].longitude': '',
      'retailLocations[1].verificationStatus': 'manual',
    })

    expect(() => parseBrandEditForm(formData)).toThrow(
      InvalidBrandEditFormError,
    )
  })

  it('includes mitStory in moderation payload', async () => {
    const { buildModerationPayload } = await import('./actions-utils')

    const proposedData = { mitStory: 'Contact factory@example.com' }
    const payload = buildModerationPayload(proposedData, 'Test Brand')

    expect(payload.fields.mitStory).toBe('Contact factory@example.com')
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

  it('derives productTagsEn from productTags on update', async () => {
    const { updateBrandAction } = await import('./actions')

    try {
      await updateBrandAction(undefined, form({
        brandSlug: 'test-brand',
        productTags: '托特包,口金包',
      }))
    } catch {
      // redirect throws
    }

    expect(updateBrand).toHaveBeenCalledWith(
      'brand-1',
      expect.objectContaining({
        productTagsEn: ['Tote Bags', 'Clasp-Frame Bags'],
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

  it('revalidates both public brand locales and the sitemap', async () => {
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

    expect(revalidatePath).toHaveBeenCalledWith('/brands/test-brand')
    expect(revalidatePath).toHaveBeenCalledWith('/en/brands/test-brand')
    expect(revalidatePath).toHaveBeenCalledWith('/sitemap.xml')
  })
})

describe('updateBrandAction — admin bypass', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ADMIN_EMAILS = 'admin@formoria.com'
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
    scanContent.mockReturnValue({ violations: [] })
  })

  it('lets an admin edit a brand they do not own', async () => {
    const { isOwnerOf } = await import('@/lib/services/brand-owners')
    vi.mocked(isOwnerOf).mockResolvedValueOnce(false)
    isActingAsAdmin.mockResolvedValue(true)
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

  it('forbids a non-owner without admin access from editing a brand', async () => {
    const { isOwnerOf } = await import('@/lib/services/brand-owners')
    vi.mocked(isOwnerOf).mockResolvedValueOnce(false)
    isActingAsAdmin.mockResolvedValueOnce(false)
    mockUser('user@formoria.com', 'user-1')

    const { updateBrandAction } = await import('./actions')

    const result = await updateBrandAction(undefined, form({
      brandSlug: 'test-brand',
      description: 'Unauthorized edit',
    }))

    expect(result).toMatchObject({ error: expect.any(String) })
    expect(updateBrand).not.toHaveBeenCalled()
  })

  it('forbids an admin whose impersonation does not match the brand', async () => {
    const { isOwnerOf } = await import('@/lib/services/brand-owners')
    vi.mocked(isOwnerOf).mockResolvedValueOnce(false)
    isActingAsAdmin.mockResolvedValue(true)
    getImpersonatedBrandSlug.mockResolvedValue('different-brand')
    mockUser('admin@formoria.com', 'admin-1')

    const { updateBrandAction } = await import('./actions')
    const result = await updateBrandAction(undefined, form({
      brandSlug: 'test-brand',
      description: 'Unauthorized admin edit',
    }))

    expect(result).toMatchObject({ error: expect.any(String) })
    expect(updateBrand).not.toHaveBeenCalled()
  })
})

describe('updateBrandAction — edit gating', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ADMIN_EMAILS = 'admin@formoria.com'
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
    scanContent.mockReturnValue({ violations: [] })
    saveModerationFlags.mockResolvedValue(undefined)
    buildViolationAdminNotificationEmail.mockResolvedValue({
      to: 'admin@formoria.com',
      from: 'Formoria <noreply@formoria.com>',
      subject: 'Violation detected',
      html: '<p>Violation detected</p>',
    })
    sendEmail.mockResolvedValue({ success: true })
  })

  it('publishes immediately when scanContent returns no violations', async () => {
    isActingAsAdmin.mockResolvedValueOnce(false)

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

    expect(scanContent).toHaveBeenCalledWith(
      'Trusted Name',
      expect.objectContaining({
        name: 'Trusted Name',
        description: 'Clean trusted description',
        website: 'https://example.com',
        purchaseUrl: 'https://shop.example.com/product',
      }),
    )
    expect(updateBrand).toHaveBeenCalledWith(
      'brand-1',
      expect.objectContaining({
        name: 'Trusted Name',
        description: 'Clean trusted description',
      })
    )
    expect(saveModerationFlags).not.toHaveBeenCalled()
  })

  it('rejects with violations when scanContent finds issues', async () => {
    isActingAsAdmin.mockResolvedValueOnce(false)
    const violations = [
      {
        field: 'description',
        rule: 'contact_injection_email',
        userMessage: 'Email addresses are not allowed',
      },
    ]
    scanContent.mockReturnValueOnce({ violations })

    const { updateBrandAction } = await import('./actions')
    const result = await updateBrandAction(undefined, form({
      brandSlug: 'test-brand',
      description: 'Contact owner@example.com',
    }))

    expect(result).toEqual({ violations })
    expect(updateBrand).not.toHaveBeenCalled()
  })

  it('sends admin notification email on violation', async () => {
    isActingAsAdmin.mockResolvedValueOnce(false)
    const violations = [
      {
        field: 'description',
        rule: 'contact_injection_email',
        userMessage: 'Email addresses are not allowed',
      },
    ]
    scanContent.mockReturnValueOnce({ violations })

    const { updateBrandAction } = await import('./actions')
    await updateBrandAction(undefined, form({
      brandSlug: 'test-brand',
      description: 'Contact owner@example.com',
    }))

    expect(buildViolationAdminNotificationEmail).toHaveBeenCalledWith({
      brandName: 'Test Brand',
      ownerEmail: 'owner@example.com',
      violations,
    })
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ subject: 'Violation detected' }),
    )
  })

  it('logs violation to moderation_flags with auto_rejected status', async () => {
    isActingAsAdmin.mockResolvedValueOnce(false)
    const violations = [
      {
        field: 'description',
        rule: 'contact_injection_email',
        userMessage: 'Email addresses are not allowed',
      },
    ]
    scanContent.mockReturnValueOnce({ violations })

    const { updateBrandAction } = await import('./actions')
    await updateBrandAction(undefined, form({
      brandSlug: 'test-brand',
      description: 'Contact owner@example.com',
    }))

    expect(saveModerationFlags).toHaveBeenCalledWith(
      'brand-1',
      'user-1',
      violations,
      'auto_rejected',
    )
  })

  it('rejects slug change attempts with error message', async () => {
    isActingAsAdmin.mockResolvedValueOnce(false)

    const { updateBrandAction } = await import('./actions')
    const result = await updateBrandAction(undefined, form({
      brandSlug: 'test-brand',
      romanizedName: 'New Public Name',
    }))

    expect(result).toEqual({ error: 'slugChangeBlocked' })
    expect(scanContent).not.toHaveBeenCalled()
    expect(updateBrand).not.toHaveBeenCalled()
  })

  it('calls completeOnboardingStep regardless of violation outcome', async () => {
    isActingAsAdmin.mockResolvedValue(false)
    scanContent.mockReturnValueOnce({
      violations: [
        {
          field: 'description',
          rule: 'contact_injection_email',
          userMessage: 'Email addresses are not allowed',
        },
      ],
    })

    const { updateBrandAction } = await import('./actions')

    await updateBrandAction(undefined, form({
      brandSlug: 'test-brand',
      description: 'Contact owner@example.com',
      onboardingStep: 'basics',
    }))

    try {
      await updateBrandAction(undefined, form({
        brandSlug: 'test-brand',
        description: 'Clean description',
        onboardingStep: 'basics',
      }))
    } catch {
      // redirect throws
    }

    expect(setBrandOnboardingStepStatus).toHaveBeenCalledTimes(2)
  })

  it('admin bypasses scan-gate entirely', async () => {
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

    expect(scanContent).not.toHaveBeenCalled()
    expect(updateBrand).toHaveBeenCalled()
  })

  it('redirects an immediate admin slug change to the new dashboard URL', async () => {
    isActingAsAdmin.mockResolvedValue(true)
    updateBrand.mockResolvedValueOnce({ slug: 'new-public-name' })
    const { redirect } = await import('next/navigation')
    const { updateBrandAction } = await import('./actions')

    await expect(
      updateBrandAction(undefined, form({
        brandSlug: 'test-brand',
        romanizedName: 'New Public Name',
      })),
    ).rejects.toThrow('NEXT_REDIRECT')

    expect(redirect).toHaveBeenCalledWith(
      expect.stringContaining('/dashboard/brands/new-public-name'),
    )
  })
})

describe('publishDraftAction — edit gating', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ADMIN_EMAILS = 'admin@formoria.com'
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
    scanContent.mockReturnValue({ violations: [] })
    saveModerationFlags.mockResolvedValue(undefined)
  })

  it('publishes a clean non-admin owner draft immediately', async () => {
    isActingAsAdmin.mockResolvedValueOnce(false)

    const { publishDraftAction } = await import('./actions')

    try {
      await publishDraftAction(undefined, form({
        brandSlug: 'test-brand',
      }))
    } catch {
      // redirect throws
    }

    expect(scanContent).toHaveBeenCalledWith(
      'Draft Name',
      expect.objectContaining({ description: 'Draft description' }),
    )
    expect(publishDraft).toHaveBeenCalledWith('brand-1')
  })

  it('rejects a non-admin owner draft when scanContent finds violations', async () => {
    isActingAsAdmin.mockResolvedValueOnce(false)
    const violations = [
      {
        field: 'description',
        rule: 'english_spam',
        userMessage: 'Spam detected',
      },
    ]
    scanContent.mockReturnValueOnce({ violations })

    const { publishDraftAction } = await import('./actions')
    const result = await publishDraftAction(undefined, form({
      brandSlug: 'test-brand',
    }))

    expect(result).toEqual({ violations })
    expect(publishDraft).not.toHaveBeenCalled()
    expect(saveModerationFlags).toHaveBeenCalledWith(
      'brand-1',
      'user-1',
      violations,
      'auto_rejected',
    )
  })

  it('rejects a non-admin owner draft slug change', async () => {
    isActingAsAdmin.mockResolvedValueOnce(false)
    getBrandDraft.mockResolvedValueOnce({ romanizedName: 'New Public Name' })

    const { publishDraftAction } = await import('./actions')
    const result = await publishDraftAction(undefined, form({
      brandSlug: 'test-brand',
    }))

    expect(result).toEqual({ error: 'slugChangeBlocked' })
    expect(scanContent).not.toHaveBeenCalled()
    expect(publishDraft).not.toHaveBeenCalled()
  })

  it('allows admin to bypass scan-gate and publish directly', async () => {
    isActingAsAdmin.mockResolvedValue(true)

    const { publishDraftAction } = await import('./actions')

    try {
      await publishDraftAction(undefined, form({
        brandSlug: 'test-brand',
      }))
    } catch {
      // redirect throws
    }

    expect(scanContent).not.toHaveBeenCalled()
    expect(publishDraft).toHaveBeenCalledWith('brand-1')
  })

  it('sanitizes admin draft location confirmations before merge and publish', async () => {
    const { isOwnerOf } = await import('@/lib/services/brand-owners')
    vi.mocked(isOwnerOf).mockResolvedValueOnce(false)
    isActingAsAdmin.mockResolvedValue(true)
    mockUser('admin@formoria.com', 'admin-1')
    getBrandBySlug.mockResolvedValue({
      id: 'brand-1',
      slug: 'test-brand',
      name: 'Test Brand',
      description: 'Original description before edit',
      socialLinks: {},
      heroImageUrl: null,
      productPhotos: [],
      retailLocations: [],
    })
    getBrandDraft.mockResolvedValue({
      name: 'Draft Name',
      description: 'Draft description',
      retailLocations: [confirmedTaipeiLocation],
    })

    const { publishDraftAction } = await import('./actions')
    await expect(
      publishDraftAction(undefined, form({ brandSlug: 'test-brand' })),
    ).rejects.toThrow('NEXT_REDIRECT')

    const sanitizedLocation = expect.objectContaining({
      confirmationStatus: 'unconfirmed',
    })
    expect(mergeDraftOverBrand).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ retailLocations: [sanitizedLocation] }),
    )
    expect(saveDraft).toHaveBeenCalledWith(
      'brand-1',
      expect.objectContaining({ retailLocations: [sanitizedLocation] }),
    )
    expect(
      saveDraft.mock.invocationCallOrder.at(0) ?? Number.POSITIVE_INFINITY,
    ).toBeLessThan(
      publishDraft.mock.invocationCallOrder.at(0) ?? Number.POSITIVE_INFINITY,
    )
  })

  it('preserves an explicit draft clear when sanitizing before publish', async () => {
    const { isOwnerOf } = await import('@/lib/services/brand-owners')
    vi.mocked(isOwnerOf).mockResolvedValueOnce(false)
    isActingAsAdmin.mockResolvedValue(true)
    mockUser('admin@formoria.com', 'admin-1')
    getBrandBySlug.mockResolvedValue({
      id: 'brand-1',
      slug: 'test-brand',
      name: 'Test Brand',
      description: 'Original description before edit',
      socialLinks: {},
      heroImageUrl: null,
      productPhotos: [],
      retailLocations: [confirmedTaipeiLocation],
    })
    getBrandDraft.mockResolvedValue({
      name: 'Draft Name',
      description: 'Draft description',
      retailLocations: [],
    })

    const { publishDraftAction } = await import('./actions')
    await expect(
      publishDraftAction(undefined, form({ brandSlug: 'test-brand' })),
    ).rejects.toThrow('NEXT_REDIRECT')

    expect(saveDraft).toHaveBeenCalledWith(
      'brand-1',
      expect.objectContaining({ retailLocations: [] }),
    )
    expect(mergeDraftOverBrand).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ retailLocations: [] }),
    )
  })
})

describe('updateBrandAction — onboarding revalidation removed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ADMIN_EMAILS = 'admin@formoria.com'
    mockUser('owner@example.com')
    isActingAsAdmin.mockResolvedValue(true)
    getBrandBySlug.mockResolvedValue({
      id: 'brand-1',
      slug: 'test-brand',
      name: 'Test Brand',
      description: 'Original description',
      socialLinks: {},
      heroImageUrl: null,
      productPhotos: [],
    })
    diffRemovedImageUrls.mockReturnValue([])
    scanContent.mockReturnValue({ violations: [] })
    isOnboardingStepKey.mockReturnValue(true)
    setBrandOnboardingStepStatus.mockResolvedValue(undefined)
  })

  it('does not revalidatePath /dashboard/onboarding', async () => {
    const { revalidatePath } = await import('next/cache')
    const { updateBrandAction } = await import('./actions')

    try {
      await updateBrandAction(undefined, form({
        brandSlug: 'test-brand',
        name: 'Test',
        onboardingStep: 'basics',
      }))
    } catch {
    }

    expect(revalidatePath).not.toHaveBeenCalledWith('/dashboard/onboarding')
  })
})
