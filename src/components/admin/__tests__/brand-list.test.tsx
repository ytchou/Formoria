// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BrandList } from '../brand-list'

vi.mock('@/app/admin/actions', () => ({
  updateBrandAction: vi.fn(),
  hideBrandAction: vi.fn(),
  unhideBrandAction: vi.fn(),
  deleteBrandAction: vi.fn(),
  resyncBrandImagesAction: vi.fn(),
  rejectMitAction: vi.fn(),
  verifyMitAction: vi.fn(),
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
    foundingYear: null,
    socialInstagram: null,
    socialThreads: null,
    socialFacebook: null,
    purchaseWebsite: null,
    purchasePinkoi: null,
    purchaseShopee: null,
    otherUrls: [],
    retailLocations: [],
    customerVoices: [],
    productPhotos: [],
    contactEmail: null,
    siteContent: null,
    priceRange: null,
    productTags: [],
    tags: [],
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
    foundingYear: null,
    socialInstagram: null,
    socialThreads: null,
    socialFacebook: null,
    purchaseWebsite: null,
    purchasePinkoi: null,
    purchaseShopee: null,
    otherUrls: [],
    retailLocations: [],
    customerVoices: [],
    productPhotos: [],
    contactEmail: null,
    siteContent: null,
    priceRange: null,
    productTags: [],
    tags: [],
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
    foundingYear: null,
    socialInstagram: null,
    socialThreads: null,
    socialFacebook: null,
    purchaseWebsite: null,
    purchasePinkoi: null,
    purchaseShopee: null,
    otherUrls: [],
    retailLocations: [],
    customerVoices: [],
    productPhotos: [],
    contactEmail: null,
    siteContent: null,
    priceRange: null,
    productTags: [],
    tags: [],
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
    expect(screen.getByRole('tab', { name: /全部/ })).toBeDefined()
    expect(screen.queryByRole('tab', { name: /待審核/ })).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /已上架/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /已隱藏/ })).toBeInTheDocument()
  })

  it('filters brands by status tab', () => {
    render(<BrandList brands={mockBrands} />)
    fireEvent.click(screen.getByRole('tab', { name: /已隱藏/ }))
    expect(screen.queryByText('Pottery Studio')).toBeNull()
    expect(screen.getByText('Tea House')).toBeDefined()
  })

  it('renders action buttons per row', () => {
    render(<BrandList brands={mockBrands} />)
    const editButtons = screen.getAllByRole('button', { name: '編輯' })
    expect(editButtons.length).toBeGreaterThanOrEqual(1)
  })

  it('shows Hide button for approved brands and Unhide for hidden brands', () => {
    render(<BrandList brands={mockBrands} />)
    // 2 approved brands → 2 Hide buttons; 1 hidden brand → 1 Unhide button
    const hideButtons = screen.getAllByRole('button', { name: '隱藏' })
    expect(hideButtons.length).toBeGreaterThanOrEqual(1)
    expect(screen.getByRole('button', { name: '取消隱藏' })).toBeDefined()
  })

  it('opens edit dialog when edit button is clicked', () => {
    render(<BrandList brands={mockBrands} />)
    const editButtons = screen.getAllByRole('button', { name: '編輯' })
    fireEvent.click(editButtons[0])
    expect(screen.getByDisplayValue('Pottery Studio')).toBeDefined()
  })
})
