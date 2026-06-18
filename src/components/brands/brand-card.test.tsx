// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import en from '../../../messages/en.json'

const mockTrackBrandCardClicked = vi.fn()
vi.mock('@/lib/analytics', () => ({
  trackBrandCardClicked: (...args: unknown[]) => mockTrackBrandCardClicked(...args),
}))

vi.mock('@/lib/auth/use-user', () => ({
  useUser: vi.fn(() => ({ user: null, loading: false })),
}))

vi.mock('@/hooks/use-saved-brands', () => ({
  useSavedBrands: vi.fn(() => ({ savedIds: new Set(), toggle: vi.fn(), loading: false })),
}))

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({ push: vi.fn() })),
  usePathname: vi.fn(() => '/'),
}))

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
  useRouter: vi.fn(() => ({ push: vi.fn() })),
  usePathname: vi.fn(() => '/'),
}))

import { BrandCard } from './brand-card'

const mockBrand = {
  id: 'b1',
  slug: 'test-brand',
  name: 'Test Brand',
  category: 'accessories',
  description: 'A test brand',
  status: 'approved' as const,
  isVerified: false,
  isDemo: false,
  logoUrl: null,
  heroImageUrl: null,
  foundingYear: 2020,
  tags: [],
  productPhotos: [],
  socialInstagram: null,
  socialThreads: null,
  socialFacebook: null,
  purchaseWebsite: null,
  purchasePinkoi: null,
  purchaseShopee: null,
  otherUrls: [],
  retailLocations: [],
  contactEmail: null,
  brandHighlights: null,
  siteContent: null,
  submittedAt: '2024-01-01',
  approvedAt: null,
  createdAt: '2024-01-01',
  updatedAt: '2024-01-01',
}

function renderWithProvider(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      {ui}
    </NextIntlClientProvider>
  )
}

describe('BrandCard', () => {
  beforeEach(() => {
    mockTrackBrandCardClicked.mockClear()
  })

  it('calls trackBrandCardClicked with slug, category, and position on click', async () => {
    const user = userEvent.setup()
    renderWithProvider(<BrandCard brand={mockBrand} position={2} />)
    await user.click(screen.getByRole('link'))
    expect(mockTrackBrandCardClicked).toHaveBeenCalledWith('test-brand', 'accessories', 2)
  })

  it('defaults position to 0 when not provided', async () => {
    const user = userEvent.setup()
    renderWithProvider(<BrandCard brand={mockBrand} />)
    await user.click(screen.getByRole('link'))
    expect(mockTrackBrandCardClicked).toHaveBeenCalledWith('test-brand', 'accessories', 0)
  })
})
