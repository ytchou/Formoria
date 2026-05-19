// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BrandList } from '../brand-list'

vi.mock('@/app/admin/actions', () => ({
  updateBrandAction: vi.fn(),
  hideBrandAction: vi.fn(),
  unhideBrandAction: vi.fn(),
  deleteBrandAction: vi.fn(),
}))

const mockBrands = [
  {
    id: 'brand-1',
    name: 'Pottery Studio',
    slug: 'pottery-studio',
    description: 'Handmade pottery',
    logoUrl: null,
    heroImageUrl: null,
    status: 'approved' as const,
    category: 'Home & Living',
    foundingYear: null,
    purchaseLinks: [],
    socialLinks: {},
    retailLocations: [],
    productPhotos: [],
    contactEmail: null,
    founder: null,
    productHighlights: [],
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
    logoUrl: null,
    heroImageUrl: null,
    status: 'hidden' as const,
    category: 'Food & Beverage',
    foundingYear: null,
    purchaseLinks: [],
    socialLinks: {},
    retailLocations: [],
    productPhotos: [],
    contactEmail: null,
    founder: null,
    productHighlights: [],
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
    logoUrl: null,
    heroImageUrl: null,
    status: 'pending' as const,
    category: null,
    foundingYear: null,
    purchaseLinks: [],
    socialLinks: {},
    retailLocations: [],
    productPhotos: [],
    contactEmail: null,
    founder: null,
    productHighlights: [],
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
    expect(screen.getByRole('tab', { name: /All/ })).toBeDefined()
    expect(screen.getByRole('tab', { name: /Approved/ })).toBeDefined()
    expect(screen.getByRole('tab', { name: /Hidden/ })).toBeDefined()
  })

  it('filters brands by status tab', () => {
    render(<BrandList brands={mockBrands} />)
    fireEvent.click(screen.getByRole('tab', { name: /Hidden/ }))
    expect(screen.queryByText('Pottery Studio')).toBeNull()
    expect(screen.getByText('Tea House')).toBeDefined()
  })

  it('renders action buttons per row', () => {
    render(<BrandList brands={mockBrands} />)
    const editButtons = screen.getAllByRole('button', { name: /edit/i })
    expect(editButtons.length).toBeGreaterThanOrEqual(1)
  })

  it('shows Hide button for approved brands and Unhide for hidden brands', () => {
    render(<BrandList brands={mockBrands} />)
    expect(screen.getByRole('button', { name: /^Hide$/i })).toBeDefined()
    expect(screen.getByRole('button', { name: /unhide/i })).toBeDefined()
  })

  it('opens edit dialog when edit button is clicked', () => {
    render(<BrandList brands={mockBrands} />)
    const editButtons = screen.getAllByRole('button', { name: /edit/i })
    fireEvent.click(editButtons[0])
    expect(screen.getByDisplayValue('Pottery Studio')).toBeDefined()
  })
})
