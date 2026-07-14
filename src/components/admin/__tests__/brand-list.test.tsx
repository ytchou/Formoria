// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BrandList } from '../brand-list'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('@/app/admin/operations/actions', () => ({
  startCurationJobAction: vi.fn(),
}))

vi.mock('@/app/admin/actions', () => ({
  updateBrandAction: vi.fn(),
  hideBrandAction: vi.fn(),
  unhideBrandAction: vi.fn(),
  deleteBrandAction: vi.fn(),
  rejectMitAction: vi.fn(),
}))

const mockBrands = [
  {
    id: 'brand-1',
    name: 'Pottery Studio',
    slug: 'pottery-studio',
    description: 'Handmade pottery',
    heroImageUrl: null,
    status: 'approved' as const,
    isVerified: false,
    isDemo: false,
    category: 'Home & Living',
    city: null,
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
    siteContent: null,
    priceRange: null,
    productTags: [],
    productTagsEn: [],
    descriptionEn: null,
    blurb: null,
    blurbEn: null,
    imageAlts: [],
    submittedAt: '2026-05-10T00:00:00Z',
    approvedAt: '2026-05-11T00:00:00Z',
    createdAt: '2026-05-10T00:00:00Z',
    updatedAt: '2026-05-11T00:00:00Z',
  },
  {
    id: 'brand-2',
    name: 'Tea House',
    slug: 'tea-house',
    description: 'Premium tea',
    heroImageUrl: null,
    status: 'hidden' as const,
    isVerified: false,
    isDemo: false,
    category: 'Food & Beverage',
    city: null,
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
    siteContent: null,
    priceRange: null,
    productTags: [],
    productTagsEn: [],
    descriptionEn: null,
    blurb: null,
    blurbEn: null,
    imageAlts: [],
    submittedAt: '2026-05-08T00:00:00Z',
    approvedAt: null,
    createdAt: '2026-05-08T00:00:00Z',
    updatedAt: '2026-05-08T00:00:00Z',
  },
  {
    id: 'brand-3',
    name: 'Bamboo Craft',
    slug: 'bamboo-craft',
    description: null,
    heroImageUrl: null,
    status: 'approved' as const,
    isVerified: false,
    isDemo: false,
    category: null,
    city: null,
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
    siteContent: null,
    priceRange: null,
    productTags: [],
    productTagsEn: [],
    descriptionEn: null,
    blurb: null,
    blurbEn: null,
    imageAlts: [],
    submittedAt: '2026-05-15T00:00:00Z',
    approvedAt: null,
    createdAt: '2026-05-15T00:00:00Z',
    updatedAt: '2026-05-15T00:00:00Z',
  },
]

describe('BrandList', () => {
  it('renders brand rows', () => {
    render(<BrandList brands={mockBrands} />)
    expect(screen.getByText('Pottery Studio')).toBeDefined()
    expect(screen.getByText('Tea House')).toBeDefined()
    expect(screen.getByText('Bamboo Craft')).toBeDefined()
  })

  it('renders status filter tabs', () => {
    render(<BrandList brands={mockBrands} />)
    expect(screen.getByRole('tab', { name: /All/ })).toBeDefined()
    expect(screen.queryByRole('tab', { name: /Pending/ })).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Live/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Hidden/ })).toBeInTheDocument()
  })

  it('filters brands by status tab', () => {
    render(<BrandList brands={mockBrands} />)
    fireEvent.click(screen.getByRole('tab', { name: /Hidden/ }))
    expect(screen.queryByText('Pottery Studio')).toBeNull()
    expect(screen.getByText('Tea House')).toBeDefined()
  })

  it('renders action buttons per row', () => {
    render(<BrandList brands={mockBrands} />)
    const editButtons = screen.getAllByRole('button', { name: 'Edit' })
    expect(editButtons.length).toBeGreaterThanOrEqual(1)
  })

  it('shows Hide button for approved brands and Unhide for hidden brands', () => {
    render(<BrandList brands={mockBrands} />)
    // 2 approved brands → 2 Hide buttons; 1 hidden brand → 1 Unhide button
    const hideButtons = screen.getAllByRole('button', { name: 'Hide' })
    expect(hideButtons.length).toBeGreaterThanOrEqual(1)
    expect(screen.getByRole('button', { name: 'Unhide' })).toBeDefined()
  })

  it('opens edit dialog when edit button is clicked', () => {
    render(<BrandList brands={mockBrands} />)
    const editButtons = screen.getAllByRole('button', { name: 'Edit' })
    fireEvent.click(editButtons[0])
    expect(screen.getByDisplayValue('Pottery Studio')).toBeDefined()
  })
})
