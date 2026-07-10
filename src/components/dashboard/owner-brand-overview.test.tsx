// @vitest-environment jsdom
import type { ComponentProps } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Brand } from '@/lib/types'
import { OwnerBrandOverview } from './owner-brand-overview'

vi.mock('next-intl/server', () => ({
  getLocale: vi.fn(async () => 'zh-TW'),
  getTranslations: vi.fn(async () => (key: string) => key),
}))

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href, ...props }: ComponentProps<'a'>) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

vi.mock('next/image', () => ({
  default: ({ alt, src }: { alt: string; src: string }) => (
    <span role="img" aria-label={alt} data-src={src} />
  ),
}))

const brand: Brand = {
  id: 'brand-1',
  name: 'Brand One',
  slug: 'brand-one',
  description: 'Brand description',
  heroImageUrl: 'https://abc.supabase.co/storage/v1/object/public/brand-images/hero.jpg',
  status: 'approved',
  productType: 'Furniture',
  city: 'Taipei',
  category: 'Home',
  isVerified: false,
  isDemo: false,
  foundingYear: 2020,
  socialInstagram: '@brand-one',
  socialThreads: null,
  socialFacebook: null,
  purchaseWebsite: 'https://example.com',
  purchasePinkoi: null,
  purchaseShopee: null,
  otherUrls: [],
  retailLocations: [{ name: 'Showroom', address: 'Taipei', latitude: 0, longitude: 0 }],
  productPhotos: ['https://abc.supabase.co/storage/v1/object/public/brand-images/product.jpg'],
  contactEmail: null,
  priceRange: 2,
  productTags: ['wood'],
  productTagsEn: [],
  descriptionEn: null,
  blurb: null,
  blurbEn: null,
  imageAlts: [],
  siteContent: null,
  submittedAt: '2026-01-01',
  approvedAt: '2026-01-02',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-02',
  reputationSummary: { text: 'Well reviewed', sources: [{ url: 'https://example.com/review' }] },
  mitStory: 'Made in Taiwan',
}

describe('OwnerBrandOverview', () => {
  it('maps every information section to its wizard step', async () => {
    render(await OwnerBrandOverview({ brand }))

    for (const [section, step] of [
      ['wizardStepBasicInfo', 0],
      ['wizardStepMedia', 1],
      ['wizardStepLinks', 2],
      ['wizardStepLocations', 3],
      ['wizardStepReputation', 4],
    ] as const) {
      expect(screen.getByRole('link', { name: `edit: ${section}` })).toHaveAttribute(
        'href',
        `/dashboard/brands/brand-one/edit?step=${step}`,
      )
    }

    for (const hint of [
      'sectionBasicInfoHint',
      'sectionBrandImagesHint',
      'sectionLinksHint',
      'sectionLocationsHint',
      'sectionReputationHint',
    ]) {
      expect(screen.getByText(hint)).toBeInTheDocument()
    }
  })

  it('shows hero and product images as separate media groups', async () => {
    render(await OwnerBrandOverview({ brand }))

    expect(screen.getByRole('heading', { name: 'fieldHeroImage' })).toBeInTheDocument()
    expect(screen.getByText('heroImageOverviewHint')).toBeInTheDocument()
    expect(screen.getByText('productPhotosOverviewHint')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'fieldProductPhotos' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'fieldHeroImage' })).toHaveAttribute(
      'data-src',
      brand.heroImageUrl,
    )
    expect(screen.getByRole('img', { name: 'fieldProductPhotos 1' })).toHaveAttribute(
      'data-src',
      brand.productPhotos.at(0),
    )
  })

  it('filters images on non-allowlisted hosts instead of rendering them', async () => {
    render(await OwnerBrandOverview({
      brand: {
        ...brand,
        heroImageUrl: 'https://cdn04.pinkoi.com/pinkoi.site/curation/hero.jpeg',
        productPhotos: [
          'https://cdn04.pinkoi.com/pinkoi.site/curation/photo.jpeg',
          'https://abc.supabase.co/storage/v1/object/public/brand-images/photo.jpg',
        ],
      },
    }))

    expect(screen.queryByRole('img', { name: 'fieldHeroImage' })).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'fieldProductPhotos 1' })).toHaveAttribute(
      'data-src',
      'https://abc.supabase.co/storage/v1/object/public/brand-images/photo.jpg',
    )
    expect(screen.queryByRole('img', { name: 'fieldProductPhotos 2' })).not.toBeInTheDocument()
  })

  it('places verification between locations and reputation', async () => {
    const { container } = render(await OwnerBrandOverview({
      brand,
      verification: <div id="verification">Verification controls</div>,
    }))

    const sections = Array.from(container.querySelectorAll('section'))
    const verificationIndex = sections.findIndex((section) =>
      section.querySelector('#verification'),
    )

    expect(sections[verificationIndex - 1]).toHaveTextContent('wizardStepLocations')
    expect(sections[verificationIndex]).toHaveTextContent('sectionVerification')
    expect(sections[verificationIndex + 1]).toHaveTextContent('wizardStepReputation')
  })

  it('localizes a stored product-type slug', async () => {
    render(await OwnerBrandOverview({ brand: { ...brand, productType: 'home' } }))

    expect(screen.getByText('居家生活')).toBeInTheDocument()
    expect(screen.queryByText('home')).not.toBeInTheDocument()
  })

  it('renders unset values with muted styling', async () => {
    render(await OwnerBrandOverview({
      brand: {
        ...brand,
        socialThreads: null,
        purchasePinkoi: null,
      },
    }))

    for (const value of screen.getAllByText('notSet')) {
      expect(value).toHaveClass('text-muted-foreground')
    }
  })

  it('uses the shared dashboard information field styles for labels and values', async () => {
    render(await OwnerBrandOverview({ brand }))

    expect(screen.getByText('fieldBrandName')).toHaveClass('type-field-label')
    expect(screen.getByText('Brand One')).toHaveClass('type-field-value')
    expect(screen.getByRole('heading', { name: 'fieldHeroImage' })).toHaveClass(
      'type-field-label',
    )
    expect(screen.getByText('heroImageOverviewHint')).toHaveClass('type-form-hint')
  })
})
