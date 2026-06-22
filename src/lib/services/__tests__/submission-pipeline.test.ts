import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Brand } from '@/lib/types'
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
  rateLimit: vi.fn(async () => ({ allowed: testState.rateAllowed, remaining: 10, resetAt: 0 })),
  createInMemoryRateLimiter: vi.fn(() => ({
    check: vi.fn(() => ({ allowed: testState.rateAllowed, remaining: 10, resetAt: 0 })),
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

vi.mock('@/lib/services/brands', () => {
  return {
    createBrand: vi.fn(),
    generateSlug: vi.fn((name: string) => name.toLowerCase().replace(/\s+/g, '-')),
  }
})

vi.mock('@/lib/services/submissions', () => {
  return {
    createSubmission: vi.fn(),
  }
})

const { createBrand } = await import('@/lib/services/brands')
const { createSubmission } = await import('@/lib/services/submissions')
const pipeline = await import('@/lib/services/submission-pipeline')
const { submitBrand } = await import('@/app/[locale]/submit/actions')

const brand = {
  id: 'brand-1',
  name: 'Test Brand',
  slug: 'test-brand',
  description: 'A useful brand description.',
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

function buildParams(
  overrides: Partial<SubmitBrandForReviewParams> = {}
): SubmitBrandForReviewParams {
  return {
    name: 'Test Brand',
    website: 'https://brand.com',
    region: 'taipei',
    isOwner: true,
    pdpaConsent: true,
    sourceAttribution: null,
    ubn: '12345678',
    retailLocations: [{ name: 'Store', address: 'Taipei', latitude: 0, longitude: 0 }],
    submitterEmail: 'user@example.com',
    submitterName: 'Test User',
    ...overrides,
  }
}

function buildSubmitInput() {
  return {
    name: 'User Brand',
    description: 'A submitted brand description.',
    category: 'Lifestyle',
    website: 'https://user.example.com',
    region: 'taipei',
    purchaseLinks: [{ platform: 'Official', url: 'https://user.example.com/shop' }],
    socialLinks: {
      instagram: '',
      threads: '',
      facebook: '',
      website: '',
    },
    retailLocations: [{ name: 'Store', address: 'Taipei' }],
    productPhotos: [],
    productType: 'skincare',
    unifiedBusinessNumber: '12345678',
    isOwner: true,
    pdpaConsent: true,
    turnstileToken: 'test-token',
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
      submitterEmail: 'user@example.com',
      submitterName: 'Test User',
      description: null,
      websiteUrl: 'https://brand.com',
      socialInstagram: null,
      socialThreads: null,
      socialFacebook: null,
      purchaseWebsite: null,
      purchasePinkoi: null,
      purchaseShopee: null,
      otherUrls: [],
      suggestedTags: { region: 'taipei' },
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
      sourceAttribution: null,
      productTypeNote: null,
    })
  })

  it('creates a pending brand and submission with region tag', async () => {
    await pipeline.submitBrandForReview(buildParams())

    expect(createBrand).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Test Brand',
        status: 'pending',
        isVerified: false,
        isDemo: false,
        heroImageUrl: null,
        foundingYear: null,
        siteContent: null,
        unifiedBusinessNumber: '12345678',
        purchaseWebsite: 'https://brand.com',
      })
    )
    expect(createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        brandId: 'brand-1',
        brandName: 'Test Brand',
        websiteUrl: 'https://brand.com',
        suggestedTags: { region: 'taipei' },
      })
    )
  })

  it('passes retailLocations from submission params to the pending brand', async () => {
    await pipeline.submitBrandForReview(buildParams())

    expect(createBrand).toHaveBeenCalledWith(
      expect.objectContaining({
        retailLocations: [{ name: 'Store', address: 'Taipei', latitude: 0, longitude: 0 }],
      })
    )
  })

  it('sets isBrandOwner and sourceAttribution on submission', async () => {
    await pipeline.submitBrandForReview(buildParams({ isOwner: false, sourceAttribution: 'found_online' }))

    expect(createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        isBrandOwner: false,
        sourceAttribution: 'found_online',
      })
    )
  })

  it('sets pdpaConsentAt when pdpaConsent is true', async () => {
    await pipeline.submitBrandForReview(buildParams({ pdpaConsent: true }))

    expect(createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        pdpaConsentAt: expect.any(String),
      })
    )
  })
})

describe('brand submission callers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    testState.isAdmin = true
    testState.rateAllowed = true
    vi.mocked(createBrand).mockResolvedValue(brand)
    vi.mocked(createSubmission).mockResolvedValue({
      id: 'submission-1',
      brandId: brand.id,
      brandName: brand.name,
      submitterEmail: 'user@example.com',
      submitterName: 'Test User',
      description: null,
      websiteUrl: 'https://user.example.com',
      socialInstagram: null,
      socialThreads: null,
      socialFacebook: null,
      purchaseWebsite: null,
      purchasePinkoi: null,
      purchaseShopee: null,
      otherUrls: [],
      suggestedTags: { region: 'taipei' },
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
  })

  it('user submission creates a pending brand and submission', async () => {
    const result = await submitBrand(buildSubmitInput())

    expect(result).toBeUndefined()
    expect(createBrand).toHaveBeenCalledWith(expect.objectContaining({
      name: 'User Brand',
      status: 'pending',
      isVerified: false,
      isDemo: false,
      contactEmail: 'user@example.com',
      unifiedBusinessNumber: '12345678',
      purchaseWebsite: 'https://user.example.com',
    }))
    expect(createSubmission).toHaveBeenCalledWith(expect.objectContaining({
      brandId: 'brand-1',
      brandName: 'User Brand',
      submitterEmail: 'user@example.com',
      submitterName: 'Test User',
      websiteUrl: 'https://user.example.com',
      isBrandOwner: true,
      sourceAttribution: 'found_online',
      suggestedTags: { region: 'taipei' },
    }))

    expect(createBrand).toHaveBeenCalledTimes(1)
    expect(createSubmission).toHaveBeenCalledTimes(1)
  })
})
