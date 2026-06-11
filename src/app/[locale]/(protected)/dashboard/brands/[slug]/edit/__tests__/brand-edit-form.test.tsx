// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render as rtlRender, screen } from '@testing-library/react'
import { type ReactElement } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import enMessages from '@/../messages/en.json'
import { BrandEditForm } from '../brand-edit-form'
import type { Brand } from '@/lib/types'

vi.mock('../actions', () => ({ updateBrandAction: vi.fn() }))

const render = (ui: ReactElement) =>
  rtlRender(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  )

function makeBrand(overrides: Partial<Brand> = {}): Brand {
  return {
    id: 'brand-1',
    name: 'Test Brand',
    slug: 'test-brand',
    description: 'Original description',
    logoUrl: null,
    heroImageUrl: null,
    status: 'approved',
    category: 'fashion',
    isVerified: false,
    isDemo: false,
    purchaseLinks: [],
    socialLinks: {},
    retailLocations: [],
    productPhotos: [],
    brandHighlights: null,
    siteContent: null,
    tags: [],
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
    expect(screen.getByLabelText(/founding year/i)).toBeInTheDocument()
  })

  it('renders Media section with logo and hero upload fields', () => {
    render(<BrandEditForm brand={mockBrand} />)
    expect(screen.getByLabelText(/logo/i)).toBeInTheDocument()
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

})
