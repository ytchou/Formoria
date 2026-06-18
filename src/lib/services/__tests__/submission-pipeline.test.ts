import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Brand } from '@/lib/types'
import type { ModerationFlag } from '@/lib/services/moderation'
import type { SubmitBrandForReviewParams } from '@/lib/services/submission-pipeline'

const testState = vi.hoisted(() => ({
  user: {
    id: 'user-1',
    email: 'user@example.com',
    user_metadata: { full_name: 'Test User' },
  },
  isAdmin: true,
  rateAllowed: true,
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}))

vi.mock('@/lib/auth/admin-mode', () => ({
  isActingAsAdmin: vi.fn(() => testState.isAdmin),
}))

vi.mock('@/lib/security/turnstile', () => ({
  verifyTurnstileToken: vi.fn(async () => ({ success: true })),
}))

vi.mock('@/lib/security/rate-limiter', () => ({
  createInMemoryRateLimiter: vi.fn(() => ({
    check: vi.fn(() => ({ allowed: testState.rateAllowed })),
  })),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: testState.user },
        error: null,
      })),
    },
  })),
  createServiceClient: vi.fn(() => ({
    from: vi.fn(),
  })),
}))

vi.mock('@/lib/validations/submission', () => ({
  createSubmissionSchema: vi.fn(() => {
    const schema = {
      parse: vi.fn((data) => data),
      safeParse: vi.fn((data) => ({ success: true, data })),
      omit: vi.fn(() => schema),
    }
    return schema
  }),
}))

vi.mock('@/lib/services/brands', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/brands')>()
  return {
    ...actual,
    createBrand: vi.fn(),
  }
})

vi.mock('@/lib/services/submissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/submissions')>()
  return {
    ...actual,
    createSubmission: vi.fn(),
    checkBrandDuplicates: vi.fn(),
  }
})

vi.mock('@/lib/services/moderation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/moderation')>()
  return {
    ...actual,
    scanContent: vi.fn(() => ({ riskLevel: 'clean', flags: [] })),
    saveModerationFlags: vi.fn(),
  }
})

const { createBrand } = await import('@/lib/services/brands')
const { createSubmission } = await import('@/lib/services/submissions')
const { scanContent, saveModerationFlags } = await import('@/lib/services/moderation')
const pipeline = await import('@/lib/services/submission-pipeline')
const { executeBulkImportAction } = await import('@/app/admin/actions')
const { submitBrand } = await import('@/app/[locale]/submit/actions')

const brand = {
  id: 'brand-1',
  name: 'Test Brand',
  slug: 'test-brand',
  description: 'A useful brand description.',
  logoUrl: null,
  heroImageUrl: null,
  status: 'pending',
  category: 'Lifestyle',
  isVerified: false,
  isDemo: false,
  foundingYear: null,
  socialInstagram: null,
  socialThreads: null,
  socialFacebook: null,
  purchaseWebsite: null,
  purchasePinkoi: null,
  purchaseShopee: null,
  otherUrls: [],
  retailLocations: [],
  productPhotos: [],
  contactEmail: null,
  brandHighlights: null,
  siteContent: null,
  tags: [],
  submittedAt: '',
  approvedAt: null,
  createdAt: '',
  updatedAt: '',
} satisfies Brand

const moderationFlags: ModerationFlag[] = [
  {
    fieldName: 'description',
    tier: 'block',
    reason: 'Suspicious content',
    flaggedContent: 'suspicious',
  },
]

function buildParams(
  overrides: Partial<SubmitBrandForReviewParams> = {}
): SubmitBrandForReviewParams {
  return {
    name: 'Test Brand',
    slug: 'test-brand',
    description: 'A useful brand description.',
    logoUrl: null,
    category: 'Lifestyle',
    purchaseLinks: [{ platform: 'Official', url: 'https://example.com/shop', label: 'Official' }],
    socialLinks: { officialWebsite: 'https://example.com' },
    retailLocations: [{ name: 'Store', address: 'Taipei', latitude: 0, longitude: 0 }],
    productPhotos: ['https://example.com/photo.jpg'],
    contactEmail: 'owner@example.com',
    brandHighlights: 'Highlights',
    unifiedBusinessNumber: '12345678',
    socialInstagram: 'brand_ig',
    socialThreads: '@brand_threads',
    socialFacebook: 'https://fb.com/brand',
    purchaseWebsite: 'https://brand.com',
    purchasePinkoi: 'https://pinkoi.com/store/brand',
    purchaseShopee: null,
    otherUrls: [{ label: 'Wholesale', url: 'https://brand.com/wholesale' }],
    submitterEmail: 'submitter@example.com',
    submitterName: 'Submitter',
    isBrandOwner: true,
    sourceAttribution: 'found_online',
    pdpaConsentAt: '2026-06-15T00:00:00.000Z',
    region: 'taipei',
    valueTags: ['eco'],
    productType: 'skincare',
    productTypeNote: 'Other type',
    moderationFlags,
    moderatorUserId: 'user-1',
    ...overrides,
  }
}

function buildSubmitInput() {
  return {
    name: 'User Brand',
    description: 'A submitted brand description.',
    category: 'Lifestyle',
    purchaseLinks: [{ platform: 'Official', url: 'https://user.example.com/shop' }],
    socialLinks: {
      instagram: '',
      threads: '',
      facebook: '',
      website: 'https://user.example.com',
    },
    retailLocations: [{ name: 'Store', address: 'Taipei' }],
    productPhotos: [],
    region: 'taipei',
    valueTags: ['eco'],
    productType: 'skincare',
    unifiedBusinessNumber: '12345678',
    isOwner: true,
    pdpaConsent: true,
    turnstileToken: 'token',
    _honeypot: '',
    sourceAttribution: 'found_online' as const,
  }
}

describe('submitBrandForReview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(createBrand).mockResolvedValue(brand)
    vi.mocked(createSubmission).mockResolvedValue({
      id: 'submission-1',
      brandId: brand.id,
      brandName: brand.name,
      submitterEmail: 'submitter@example.com',
      submitterName: 'Submitter',
      description: brand.description,
      websiteUrl: null,
      socialInstagram: null,
      socialThreads: null,
      socialFacebook: null,
      purchaseWebsite: null,
      purchasePinkoi: null,
      purchaseShopee: null,
      otherUrls: [],
      suggestedTags: {},
      status: 'pending',
      reviewerNotes: null,
      submittedAt: '',
      reviewedAt: null,
      reviewedBy: null,
      pdpaConsentAt: null,
      validationStatus: null,
      validationErrors: null,
      notifiedAt: null,
      isBrandOwner: true,
      sourceAttribution: 'found_online',
      productTypeNote: null,
    })
    vi.mocked(saveModerationFlags).mockResolvedValue(undefined)
  })

  it('creates a pending brand and submission with suggested tags', async () => {
    await pipeline.submitBrandForReview(buildParams())

    expect(createBrand).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Test Brand',
        slug: 'test-brand',
        status: 'pending',
        isVerified: false,
        isDemo: false,
        heroImageUrl: null,
        foundingYear: null,
        siteContent: null,
        unifiedBusinessNumber: '12345678',
      })
    )
    expect(createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        brandId: 'brand-1',
        brandName: 'Test Brand',
        websiteUrl: 'https://brand.com',
        suggestedTags: {
          region: 'taipei',
          values: ['eco'],
          productType: 'skincare',
        },
      })
    )
  })

  it('carries flat link fields from submission params to the pending brand and submission', async () => {
    await pipeline.submitBrandForReview(buildParams())

    expect(createBrand).toHaveBeenCalledWith(
      expect.objectContaining({
        socialInstagram: 'brand_ig',
        socialThreads: '@brand_threads',
        socialFacebook: 'https://fb.com/brand',
        purchaseWebsite: 'https://brand.com',
        purchasePinkoi: 'https://pinkoi.com/store/brand',
        purchaseShopee: null,
        otherUrls: [{ label: 'Wholesale', url: 'https://brand.com/wholesale' }],
      })
    )
    expect(createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        socialInstagram: 'brand_ig',
        socialThreads: '@brand_threads',
        socialFacebook: 'https://fb.com/brand',
        purchaseWebsite: 'https://brand.com',
        purchasePinkoi: 'https://pinkoi.com/store/brand',
        purchaseShopee: null,
        otherUrls: [{ label: 'Wholesale', url: 'https://brand.com/wholesale' }],
      })
    )
  })

  it('saves moderation flags when present', async () => {
    await pipeline.submitBrandForReview(buildParams())

    expect(saveModerationFlags).toHaveBeenCalledWith('brand-1', 'user-1', moderationFlags)
  })

  it('does not save moderation flags when empty', async () => {
    await pipeline.submitBrandForReview(buildParams({ moderationFlags: [] }))

    expect(saveModerationFlags).not.toHaveBeenCalled()
  })
})

describe('brand submission callers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    testState.isAdmin = true
    testState.rateAllowed = true
    vi.mocked(scanContent).mockReturnValue({ riskLevel: 'clean', flags: moderationFlags })
  })

  it('bulk import and user submission use the same pipeline', async () => {
    const pipelineSpy = vi
      .spyOn(pipeline, 'submitBrandForReview')
      .mockResolvedValue({ brand, submissionId: 'submission-1' })

    const validatedData = {
      name: 'Bulk Brand',
      slug: 'bulk-brand',
      description: 'A bulk imported brand description.',
      category: 'Lifestyle',
      logoUrl: null,
      productPhotos: [],
      purchaseLinks: [{ platform: 'Official', url: 'https://bulk.example.com/shop' }],
      socialLinks: { instagram: '', threads: '', facebook: '', website: 'https://bulk.example.com' },
      retailLocations: [{ name: 'Store', address: 'Taipei' }],
      brandHighlights: null,
      region: 'taipei',
      valueTags: ['eco'],
      productType: 'skincare',
      productTypeNote: null,
      unifiedBusinessNumber: '12345678',
    }

    await executeBulkImportAction([
      {
        rowIndex: 1,
        name: 'Bulk Brand',
        slug: 'bulk-brand',
        validatedData,
        status: 'valid',
        moderationFlags,
      },
    ])
    await submitBrand(buildSubmitInput())

    expect(pipelineSpy).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Bulk Brand',
      slug: 'bulk-brand',
      submitterName: 'Bulk Import',
      isBrandOwner: false,
    }))
    expect(pipelineSpy).toHaveBeenCalledWith(expect.objectContaining({
      name: 'User Brand',
      slug: '',
      submitterName: 'Test User',
      isBrandOwner: true,
    }))
    expect(pipelineSpy).toHaveBeenCalledTimes(2)
  })
})
