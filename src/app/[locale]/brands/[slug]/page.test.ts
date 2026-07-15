import { beforeEach, describe, expect, it, vi } from 'vitest'

const brandServiceMocks = vi.hoisted(() => ({
  findBrandByOldSlug: vi.fn(),
  getApprovedBrandBySlug: vi.fn(),
  getBrandBySlug: vi.fn(),
}))

const navigationMocks = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  notFound: navigationMocks.notFound,
  permanentRedirect: vi.fn(),
}))

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
  setRequestLocale: vi.fn(),
}))

vi.mock('@/lib/services/brands', () => ({
  findBrandByOldSlug: brandServiceMocks.findBrandByOldSlug,
  getAllBrandSlugs: vi.fn(),
  getApprovedBrandBySlug: brandServiceMocks.getApprovedBrandBySlug,
  getBrandBySlug: brandServiceMocks.getBrandBySlug,
  getBrandCountByCategory: vi.fn(),
  getRelatedBrands: vi.fn(),
}))

import { generateMetadata } from './page'

const approvedBrand = {
  name: 'Niizo',
  slug: 'niizo',
  description: '以天然帆布與皮革製作耐用包款的台灣慢時尚品牌。',
  descriptionEn:
    'A Taiwanese slow-fashion studio crafting durable bags from natural canvas and leather.',
  blurb: '台灣手工慢時尚包款',
  blurbEn: 'Taiwanese slow-fashion bags handcrafted from canvas and leather.',
  heroImageUrl: null,
}

describe('brand detail data visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    brandServiceMocks.getApprovedBrandBySlug.mockResolvedValue(approvedBrand)
    brandServiceMocks.getBrandBySlug.mockResolvedValue(approvedBrand)
  })

  it('loads metadata through the approved-only public brand query', async () => {
    await generateMetadata({
      params: Promise.resolve({ locale: 'zh-TW', slug: approvedBrand.slug }),
    })

    expect(brandServiceMocks.getApprovedBrandBySlug).toHaveBeenCalledWith(approvedBrand.slug)
    expect(brandServiceMocks.getBrandBySlug).not.toHaveBeenCalled()
  })

  it('preserves the not-found signal for non-public brands', async () => {
    const { NotFoundError } = await import('@/lib/errors')
    brandServiceMocks.getApprovedBrandBySlug.mockRejectedValue(
      new NotFoundError('Brand', 'hidden-brand'),
    )
    brandServiceMocks.findBrandByOldSlug.mockResolvedValue(null)

    await expect(
      generateMetadata({
        params: Promise.resolve({ locale: 'zh-TW', slug: 'hidden-brand' }),
      }),
    ).rejects.toThrow('NEXT_NOT_FOUND')
    expect(navigationMocks.notFound).toHaveBeenCalled()
  })
})
