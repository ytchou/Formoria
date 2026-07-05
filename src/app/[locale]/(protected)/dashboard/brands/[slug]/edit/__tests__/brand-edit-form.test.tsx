// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render as rtlRender, screen } from '@testing-library/react'
import { type ReactElement } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import enMessages from '@/../messages/en.json'
import { BrandEditForm } from '../brand-edit-form'
import type { Brand } from '@/lib/types'

vi.mock('../actions', () => ({ updateBrandAction: vi.fn() }))

const render = (ui: ReactElement, locale = 'en') =>
  rtlRender(
    <NextIntlClientProvider locale={locale} messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  )

function makeBrand(overrides: Partial<Brand> = {}): Brand {
  return {
    id: 'brand-1',
    name: 'Test Brand',
    slug: 'test-brand',
    description: 'Original description',
    heroImageUrl: null,
    status: 'approved',
    productType: 'fashion',
    category: 'fashion',
    city: null,
    isVerified: false,
    isDemo: false,
    socialInstagram: null,
    socialThreads: null,
    socialFacebook: null,
    purchaseWebsite: null,
    purchasePinkoi: null,
    purchaseShopee: null,
    mitStory: null,
    otherUrls: [],
    retailLocations: [],
    customerVoices: [],
    productPhotos: [],
    priceRange: null,
    productTags: [],
    siteContent: null,
    foundingYear: 2020,
    contactEmail: null,
    submittedAt: '2026-01-01T00:00:00Z',
    approvedAt: '2026-01-02T00:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

const mockBrand = makeBrand()

describe('BrandEditForm — sections', () => {
  it('renders Basic Info section with existing fields', () => {
    render(<BrandEditForm brand={mockBrand} />)
    expect(screen.getByLabelText(/description/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/category/i)).toHaveValue('fashion')
    expect(screen.getByLabelText(/city\/county/i)).toHaveValue('')
    expect(screen.getByLabelText(/founding year/i)).toBeInTheDocument()
  })

  it('renders the city select with Taiwan cities', () => {
    render(<BrandEditForm brand={makeBrand({ city: 'taipei' })} />)
    expect(screen.getByLabelText(/city\/county/i)).toHaveValue('taipei')
    expect(screen.getByRole('option', { name: 'Taipei City' })).toBeInTheDocument()
  })

  it('renders Media section with hero upload field', () => {
    render(<BrandEditForm brand={mockBrand} />)
    expect(screen.getByLabelText(/hero image/i)).toBeInTheDocument()
  })

  it('renders Links section with purchase links array', () => {
    render(<BrandEditForm brand={mockBrand} />)
    expect(screen.getByRole('button', { name: /add.*link/i })).toBeInTheDocument()
  })

  it('renders Locations section with retail locations array', () => {
    render(<BrandEditForm brand={mockBrand} />)
    expect(screen.getByRole('button', { name: /add.*location/i })).toBeInTheDocument()
  })

  it('renders the MIT story textarea', () => {
    const brand = makeBrand({ mitStory: 'Our looms have been running since 1960.' })
    render(<BrandEditForm brand={brand} />)
    const textarea = screen.getByRole('textbox', { name: /MIT Manufacturing Story/i })
    expect(textarea).toBeInTheDocument()
    expect(textarea).toHaveValue('Our looms have been running since 1960.')
    expect(textarea).toHaveAttribute('name', 'mitStory')
  })

  it('renders empty MIT story textarea when brand has no story', () => {
    const brand = makeBrand({ mitStory: null })
    render(<BrandEditForm brand={brand} />)
    const textarea = screen.getByRole('textbox', { name: /MIT Manufacturing Story/i })
    expect(textarea).toHaveValue('')
  })

})
