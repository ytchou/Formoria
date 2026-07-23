// @vitest-environment jsdom
import type { ComponentProps } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Brand } from '@/lib/types'
import { getBrandBySlug } from '@/lib/services/brands'
import InfoPage from './page'

vi.mock('next-intl/server', () => ({
  setRequestLocale: vi.fn(),
  getTranslations: vi.fn(() => (key: string) => key),
}))

vi.mock('@/lib/services/brands', () => ({
  getBrandBySlug: vi.fn(),
}))

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href, ...props }: ComponentProps<'a'>) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

const brand: Brand = {
  id: 'brand-1',
  name: 'Formoria',
  slug: 'formoria',
  description: 'Thoughtful objects made in Taiwan.',
  descriptionEn: null,
  blurb: null,
  blurbEn: null,
  heroImageUrl: null,
  status: 'approved',
  productType: 'home',
  city: 'Taipei',
  category: 'Home',
  isVerified: false,
  isDemo: false,
  foundingYear: 2021,
  socialInstagram: null,
  socialThreads: null,
  socialFacebook: null,
  purchaseWebsite: null,
  purchasePinkoi: null,
  purchaseShopee: null,
  otherUrls: [],
  productPhotos: [],
  imageAlts: [],
  contactEmail: null,
  priceRange: 2,
  productTags: ['furniture', 'lighting'],
  productTagsEn: [],
  siteContent: null,
  submittedAt: '2026-01-01',
  approvedAt: '2026-01-02',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-02',
  onboardingDismissedAt: null,
}

describe('InfoPage', () => {
  it('info page renders brand fields with InfoField', async () => {
    vi.mocked(getBrandBySlug).mockResolvedValue(brand)

    render(
      await InfoPage({
        params: Promise.resolve({ locale: 'en', slug: 'formoria' }),
      }),
    )

    expect(screen.getByText('Formoria')).toBeInTheDocument()
    expect(screen.getByText('Home & Living')).toBeInTheDocument()
    expect(screen.getByText('Thoughtful objects made in Taiwan.')).toBeInTheDocument()
    expect(screen.getByText('2021')).toBeInTheDocument()
    expect(screen.getByText('Taipei')).toBeInTheDocument()
    expect(screen.getByText('fieldPriceRangeMidRange')).toBeInTheDocument()
    expect(screen.getByText('furniture · lighting')).toBeInTheDocument()
  })

  it('info page renders edit button linking to wizard step 0', async () => {
    vi.mocked(getBrandBySlug).mockResolvedValue(brand)

    render(
      await InfoPage({
        params: Promise.resolve({ locale: 'en', slug: 'formoria' }),
      }),
    )

    expect(screen.getByRole('link', { name: 'edit: wizardStepBasicInfo' })).toHaveAttribute(
      'href',
      expect.stringContaining('edit?step=0'),
    )
  })
})
