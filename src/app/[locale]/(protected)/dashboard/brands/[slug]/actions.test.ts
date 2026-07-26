import { describe, it, expect, vi, beforeEach } from 'vitest'
import zhMessages from '../../../../../../../messages/zh-TW.json'
import { ConflictError } from '@/lib/errors'

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

  it('includes mitStory in moderation payload', async () => {
    const { buildModerationPayload } = await import('./actions-utils')

    const proposedData = { mitStory: 'Contact factory@example.com' }
    const payload = buildModerationPayload(proposedData, 'Test Brand')

    expect(payload.fields.mitStory).toBe('Contact factory@example.com')
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


})

describe('updateBrandAction — admin moderation', () => {
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


  it('queues violations for admin edits instead of bypassing moderation', async () => {
    const violations = [
      {
        field: 'description',
        rule: 'contact_injection_phone',
        userMessage: 'Phone numbers are not allowed in this field',
      },
    ]
    scanContent.mockReturnValue({ violations })
    mockUser('admin@formoria.com', 'admin-1')

    const { updateBrandAction } = await import('./actions')
    try {
      const result = await updateBrandAction(undefined, form({
        brandSlug: 'test-brand',
        description: 'Call me at 0912345678',
      }))

      expect(result).toEqual({ violations })
      expect(updateBrand).not.toHaveBeenCalled()
      expect(saveModerationFlags).toHaveBeenCalledWith(
        'brand-1',
        'admin-1',
        violations,
        'pending',
      )
    } finally {
      scanContent.mockReturnValue({ violations: [] })
    }
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


  it('surfaces a stale draft conflict without publishing', async () => {
    isActingAsAdmin.mockResolvedValueOnce(false)
    publishDraft.mockRejectedValueOnce(new ConflictError('Draft is stale'))

    const { publishDraftAction } = await import('./actions')
    const result = await publishDraftAction(undefined, form({
      brandSlug: 'test-brand',
    }))

    expect(result).toEqual({
      error: '草稿有較新的品牌資料，請重新載入後確認再發布。',
    })
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
      'pending',
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

  it('queues violations for admin draft publishes instead of bypassing moderation', async () => {
    isActingAsAdmin.mockResolvedValue(true)
    const violations = [
      {
        field: 'description',
        rule: 'contact_injection_phone',
        userMessage: 'Phone numbers are not allowed in this field',
      },
    ]
    scanContent.mockReturnValue({ violations })

    const { publishDraftAction } = await import('./actions')
    try {
      const result = await publishDraftAction(undefined, form({
        brandSlug: 'test-brand',
      }))

      expect(result).toEqual({ violations })
      expect(scanContent).toHaveBeenCalled()
      expect(publishDraft).not.toHaveBeenCalled()
      expect(saveModerationFlags).toHaveBeenCalledWith(
        'brand-1',
        'user-1',
        violations,
        'pending',
      )
    } finally {
      scanContent.mockReturnValue({ violations: [] })
    }
  })

  it('revalidates both public brand locales after publishing', async () => {
    const { revalidatePath } = await import('next/cache')
    isActingAsAdmin.mockResolvedValue(false)

    const { publishDraftAction } = await import('./actions')
    await expect(
      publishDraftAction(undefined, form({ brandSlug: 'test-brand' })),
    ).rejects.toThrow('NEXT_REDIRECT')

    expect(revalidatePath).toHaveBeenCalledWith('/zh-TW/brands/test-brand')
    expect(revalidatePath).toHaveBeenCalledWith('/en/brands/test-brand')
    expect(revalidatePath).not.toHaveBeenCalledWith('/brands/test-brand')
  })
})
