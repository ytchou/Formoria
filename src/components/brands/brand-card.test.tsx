// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import en from '../../../messages/en.json'

const mockTrackBrandCardClicked = vi.fn()
vi.mock('@/lib/analytics', () => ({
  trackBrandCardClicked: (...args: unknown[]) =>
    mockTrackBrandCardClicked(...args),
}))

vi.mock('@/lib/auth/use-user', () => ({
  useUser: vi.fn(() => ({ user: null, loading: false })),
}))

vi.mock('@/hooks/use-saved-brands', () => ({
  useSavedBrands: vi.fn(() => ({
    savedIds: new Set(),
    toggle: vi.fn(),
    loading: false,
  })),
}))

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({ push: vi.fn() })),
  usePathname: vi.fn(() => '/'),
}))

vi.mock('@/i18n/navigation', () => ({
  Link: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  useRouter: vi.fn(() => ({ push: vi.fn() })),
  usePathname: vi.fn(() => '/'),
}))

vi.mock('next/image', () => ({
  default: ({ alt = '', fill, ...props }: Record<string, unknown>) => {
    void fill
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img alt={String(alt)} {...props} />
    )
  },
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
  heroImageUrl: null,
  city: null,
  foundingYear: 2020,
  productPhotos: [],
  socialInstagram: null,
  socialThreads: null,
  socialFacebook: null,
  purchaseWebsite: null,
  purchasePinkoi: null,
  purchaseShopee: null,
  otherUrls: [],
  contactEmail: null,
  siteContent: null,
  priceRange: null,
  productTags: [],
  productTagsEn: [],
  descriptionEn: null,
  blurb: null,
  blurbEn: null,
  imageAlts: [],
  submittedAt: '2024-01-01',
  approvedAt: null,
  createdAt: '2024-01-01',
  updatedAt: '2024-01-01',
  onboardingDismissedAt: null,
}

function renderWithProvider(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      {ui}
    </NextIntlClientProvider>,
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
    expect(mockTrackBrandCardClicked).toHaveBeenCalledWith(
      'test-brand',
      'accessories',
      2,
      'b1',
    )
  })

  it('defaults position to 0 when not provided', async () => {
    const user = userEvent.setup()
    renderWithProvider(<BrandCard brand={mockBrand} />)
    await user.click(screen.getByRole('link'))
    expect(mockTrackBrandCardClicked).toHaveBeenCalledWith(
      'test-brand',
      'accessories',
      0,
      'b1',
    )
  })

  it('loads prioritized card images eagerly and other cards lazily', () => {
    const eagerBrand = {
      ...mockBrand,
      name: 'Eager Brand',
      heroImageUrl:
        'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/eager.webp',
    }
    const lazyBrand = {
      ...mockBrand,
      name: 'Lazy Brand',
      heroImageUrl:
        'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/lazy.webp',
    }

    const { container } = renderWithProvider(
      <>
        <BrandCard brand={eagerBrand} priority />
        <BrandCard brand={lazyBrand} />
      </>,
    )

    // Images are decorative (alt="") — query by URL to identify each card's image
    const imgs = Array.from(container.querySelectorAll('img'))
    const eagerImg = imgs.find((img) => img.src.includes('eager'))
    const lazyImg = imgs.find((img) => img.src.includes('lazy'))
    expect(eagerImg).toHaveAttribute('loading', 'eager')
    expect(lazyImg).toHaveAttribute('loading', 'lazy')
  })
})
