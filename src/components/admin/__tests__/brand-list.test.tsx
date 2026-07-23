// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { BrandList } from '../brand-list'

const resendClaimInviteAction = vi.hoisted(() => vi.fn())
const requestBrandRefreshAction = vi.hoisted(() => vi.fn())
const toastSuccess = vi.hoisted(() => vi.fn())

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
  resendClaimInviteAction,
  requestBrandRefreshAction,
  rejectMitAction: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: { success: toastSuccess, error: vi.fn(), info: vi.fn() },
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
    onboardingDismissedAt: null,
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
    onboardingDismissedAt: null,
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
    onboardingDismissedAt: null,
  },
]

describe('BrandList', () => {
  it('renders the declared status label for declared brands', () => {
    render(
      <BrandList
        brands={[{ ...mockBrands[0], mitStatus: 'declared' as const }]}
      />
    )

    expect(screen.getByText('品牌聲明')).toBeInTheDocument()
  })

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

  it('keeps filter controls tall enough for their text', () => {
    render(<BrandList brands={mockBrands} />)

    expect(screen.getByPlaceholderText('Search brand name...')).toHaveClass('h-12')
    expect(screen.getByDisplayValue('All MIT status')).toHaveClass('h-12')
    expect(screen.getByDisplayValue('All categories')).toHaveClass('h-12')
  })

  it('filters brands by status tab', () => {
    render(<BrandList brands={mockBrands} />)
    fireEvent.click(screen.getByRole('tab', { name: /Hidden/ }))
    expect(screen.queryByText('Pottery Studio')).toBeNull()
    expect(screen.getByText('Tea House')).toBeDefined()
  })

  it('paginates the filtered brand rows', () => {
    const brands = Array.from({ length: 12 }, (_, index) => ({
      ...mockBrands[0],
      id: `brand-${index + 1}`,
      name: `Brand ${index + 1}`,
      slug: `brand-${index + 1}`,
    }))

    render(<BrandList brands={brands} />)

    expect(screen.getByText('Brand 10')).toBeInTheDocument()
    expect(screen.queryByText('Brand 11')).not.toBeInTheDocument()
    expect(screen.getByText('Showing 1–10 of 12 brands')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))

    expect(screen.queryByText('Brand 10')).not.toBeInTheDocument()
    expect(screen.getByText('Brand 11')).toBeInTheDocument()
    expect(screen.getByText('Brand 12')).toBeInTheDocument()
    expect(screen.getByText('Showing 11–12 of 12 brands')).toBeInTheDocument()
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

  it('only offers claim-invite resend for eligible brands', () => {
    render(<BrandList brands={mockBrands} claimInviteBrandIds={['brand-1']} />)

    const eligibleRow = screen.getByText('Pottery Studio').closest('tr')
    const ineligibleRow = screen.getByText('Bamboo Craft').closest('tr')
    expect(eligibleRow).not.toBeNull()
    expect(ineligibleRow).not.toBeNull()
    expect(
      within(eligibleRow as HTMLElement).getByRole('button', {
        name: 'Resend claim invite',
      })
    ).toBeInTheDocument()
    expect(
      within(ineligibleRow as HTMLElement).queryByRole('button', {
        name: 'Resend claim invite',
      })
    ).not.toBeInTheDocument()
  })

  it('resends an eligible claim invite and reports success', async () => {
    resendClaimInviteAction.mockResolvedValue({ resent: true })
    render(<BrandList brands={mockBrands} claimInviteBrandIds={['brand-1']} />)

    fireEvent.click(screen.getByRole('button', { name: 'Resend claim invite' }))

    await waitFor(() => {
      expect(resendClaimInviteAction).toHaveBeenCalledWith('brand-1')
    })
    expect(toastSuccess).toHaveBeenCalledWith('Claim invitation sent')
  })

  it('confirms a scheduled refresh request without dispatching enrichment', async () => {
    requestBrandRefreshAction.mockResolvedValue({ submissionId: 'refresh-1' })
    render(<BrandList brands={mockBrands} />)

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Open brand actions for Pottery Studio',
      })
    )
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Request re-enrichment' }))
    fireEvent.click(screen.getByRole('button', { name: 'Request re-enrichment' }))

    await waitFor(() => {
      expect(requestBrandRefreshAction).toHaveBeenCalledWith('brand-1')
    })
    expect(toastSuccess).toHaveBeenCalledWith('Re-enrichment requested for the next scheduled run')
  })

  it('surfaces duplicate refresh requests from the transaction', async () => {
    requestBrandRefreshAction.mockResolvedValue({
      error: 'A refresh is already pending for this brand',
    })
    render(<BrandList brands={mockBrands} />)

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Open brand actions for Pottery Studio',
      })
    )
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Request re-enrichment' }))
    fireEvent.click(screen.getByRole('button', { name: 'Request re-enrichment' }))

    expect(
      await screen.findByText('A refresh is already pending for this brand')
    ).toBeInTheDocument()
  })
})
