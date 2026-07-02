// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('next-intl', () => ({
  useTranslations: vi.fn(() => (key: string) => key),
}))
vi.mock('next-intl/server', () => ({ getTranslations: vi.fn(async () => (key: string) => key), setRequestLocale: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn().mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1', email: 'test@example.com' } }, error: null }) } }) }))
vi.mock('@/lib/services/brands', () => ({ getBrandBySlug: vi.fn() }))
vi.mock('@/lib/services/brand-owners', () => ({ getUserBrands: vi.fn(), isOwnerOf: vi.fn(async () => true) }))
vi.mock('@/components/dashboard/badge-section', () => ({
  BadgeSection: () => <div data-testid="badge-section" />,
}))
vi.mock('@/lib/site-url', () => ({
  getSiteUrl: () => 'https://formoria.com',
}))
vi.mock('@/components/brands/brand-about', () => ({
  BrandAbout: ({ brand }: { brand: Brand }) => <p>{brand.description}</p>,
}))
vi.mock('@/components/brands/brand-customer-voices', () => ({
  BrandCustomerVoices: () => <div data-testid="customer-voices" />,
}))
vi.mock('@/components/brands/brand-locations', () => ({
  BrandLocations: () => <div data-testid="brand-locations" />,
}))
vi.mock('@/components/brands/brand-links', () => ({
  BrandLinks: () => (
    <>
      <div data-testid="social-links" />
      <div data-testid="purchase-links" />
      <div data-testid="other-links" />
    </>
  ),
}))

import { getBrandBySlug } from '@/lib/services/brands'
import { getUserBrands } from '@/lib/services/brand-owners'
import type { Brand } from '@/lib/types/brand'
import DashboardPage from '../page'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getUserBrands).mockResolvedValue([{ brandId: 'b1', brandName: 'Test Brand', brandSlug: 'test-brand', heroImageUrl: null, claimedAt: '2026-01-01' }])
  vi.mocked(getBrandBySlug).mockResolvedValue({
    id: 'b1', name: 'Test Brand', slug: 'test-brand', description: 'A test brand', category: 'food',
    heroImageUrl: null, status: 'approved', isVerified: false, isDemo: false, foundingYear: 2020,
    socialInstagram: '@test', socialThreads: null, socialFacebook: null,
    purchaseWebsite: 'https://test.com', purchasePinkoi: null, purchaseShopee: null,
    otherUrls: [], retailLocations: [], customerVoices: [], productPhotos: [],
    contactEmail: null, priceRange: 2, productTags: ['tea', 'organic'],
    siteContent: null, submittedAt: '2026-01-01', approvedAt: null, createdAt: '2026-01-01', updatedAt: '2026-01-01',
  } as Brand)
})

describe('DashboardPage (Brand Profile)', () => {
  it('renders brand name and description', async () => {
    render(await DashboardPage({ params: Promise.resolve({ locale: 'en' }), searchParams: Promise.resolve({ brand: 'test-brand' }) }))
    expect(screen.getByText('Test Brand')).toBeInTheDocument()
    expect(screen.getByText('A test brand')).toBeInTheDocument()
  })

  it('stacks the hero image above the brand title', async () => {
    vi.mocked(getBrandBySlug).mockResolvedValue({
      ...(await vi.mocked(getBrandBySlug)('test-brand')),
      heroImageUrl: 'https://example.com/hero.jpg',
    })

    render(await DashboardPage({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({ brand: 'test-brand' }),
    }))

    const image = screen.getByRole('img', { name: 'Test Brand' })
    const heading = screen.getByRole('heading', { name: 'Test Brand' })
    expect(screen.getByTestId('brand-profile')).toHaveClass('space-y-8')
    expect(image.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('does not render a page-level edit link (edit CTA is in the layout header)', async () => {
    render(await DashboardPage({ params: Promise.resolve({ locale: 'en' }), searchParams: Promise.resolve({ brand: 'test-brand' }) }))
    const editLinks = screen.queryAllByRole('link', { name: /edit/i })
    expect(editLinks).toHaveLength(0)
  })

  it('renders every product photo in one horizontally scrollable row', async () => {
    const photos = Array.from({ length: 6 }, (_, index) => `https://example.com/photo-${index + 1}.jpg`)
    vi.mocked(getBrandBySlug).mockResolvedValue({
      ...(await vi.mocked(getBrandBySlug)('test-brand')),
      productPhotos: photos,
    })

    render(await DashboardPage({ params: Promise.resolve({ locale: 'en' }), searchParams: Promise.resolve({ brand: 'test-brand' }) }))

    const gallery = screen.getByRole('region', { name: 'productPhotos' })
    expect(gallery).toHaveClass('flex', 'overflow-x-auto')
    expect(screen.getAllByRole('img', { name: /Test Brand product/ })).toHaveLength(6)
  })

  it('reuses the public detail link sections and meta pill styling', async () => {
    render(await DashboardPage({ params: Promise.resolve({ locale: 'en' }), searchParams: Promise.resolve({ brand: 'test-brand' }) }))

    expect(screen.getByTestId('social-links')).toBeInTheDocument()
    expect(screen.getByTestId('purchase-links')).toBeInTheDocument()
    expect(screen.getByTestId('other-links')).toBeInTheDocument()
    expect(screen.getByTestId('brand-profile')).toHaveClass('w-full')
    expect(screen.getByText('food')).toHaveClass('bg-primary/10', 'text-primary')
    expect(screen.getByText('$$')).toHaveClass('bg-amber-100', 'text-amber-800')
    expect(screen.getByText('tea')).toHaveClass('bg-secondary', 'text-secondary-foreground')
  })

  it('renders the badge section for an approved brand', async () => {
    render(await DashboardPage({ params: Promise.resolve({ locale: 'en' }), searchParams: Promise.resolve({ brand: 'test-brand' }) }))
    expect(screen.getByTestId('badge-section')).toBeInTheDocument()
  })

  it('does not render the badge section for a non-approved brand', async () => {
    vi.mocked(getBrandBySlug).mockResolvedValue({
      ...(await vi.mocked(getBrandBySlug)('test-brand')),
      status: 'hidden',
    })
    render(await DashboardPage({ params: Promise.resolve({ locale: 'en' }), searchParams: Promise.resolve({ brand: 'test-brand' }) }))
    expect(screen.queryByTestId('badge-section')).not.toBeInTheDocument()
  })
})
