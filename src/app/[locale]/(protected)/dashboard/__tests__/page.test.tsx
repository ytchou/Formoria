// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('next-intl/server', () => ({ getTranslations: vi.fn(async () => (key: string) => key), setRequestLocale: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn().mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1', email: 'test@example.com' } }, error: null }) } }) }))
vi.mock('@/lib/services/brands', () => ({ getBrandBySlug: vi.fn() }))
vi.mock('@/lib/services/brand-owners', () => ({ getUserBrands: vi.fn(), isOwnerOf: vi.fn(async () => true) }))

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
    contactEmail: null, priceRange: 2, productTags: ['tea', 'organic'], tags: [],
    siteContent: null, submittedAt: '2026-01-01', approvedAt: null, createdAt: '2026-01-01', updatedAt: '2026-01-01',
  } as Brand)
})

describe('DashboardPage (Brand Profile)', () => {
  it('renders brand name and description', async () => {
    render(await DashboardPage({ params: Promise.resolve({ locale: 'en' }), searchParams: Promise.resolve({ brand: 'test-brand' }) }))
    expect(screen.getByText('Test Brand')).toBeInTheDocument()
    expect(screen.getByText('A test brand')).toBeInTheDocument()
  })

  it('renders edit CTA linking to edit page', async () => {
    render(await DashboardPage({ params: Promise.resolve({ locale: 'en' }), searchParams: Promise.resolve({ brand: 'test-brand' }) }))
    const editLink = screen.getByRole('link', { name: /edit/i })
    expect(editLink).toHaveAttribute('href', expect.stringContaining('/dashboard/brands/test-brand/edit'))
  })
})
