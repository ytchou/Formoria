// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { BrandHeader } from '../brand-header'
import type { Brand } from '@/lib/types'
import en from '../../../../messages/en.json'

const fixtureBrand: Brand = {
  id: 'brand-en-1',
  name: 'Sunrise Tea',
  slug: 'sunrise-tea',
  description: 'A premium Taiwanese tea brand.',
  logoUrl: null,
  heroImageUrl: null,
  status: 'approved',
  category: 'food-beverage',
  isVerified: true,
  isDemo: false,
  purchaseLinks: [],
  socialLinks: {},
  retailLocations: [],
  productPhotos: [],
  brandHighlights: null,
  tags: [],
  foundingYear: 2010,
  contactEmail: null,
  submittedAt: '2026-01-01T00:00:00Z',
  approvedAt: '2026-01-02T00:00:00Z',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

describe('BrandHeader — English locale (i18n)', () => {
  it('renders English chrome labels while keeping brand proper noun unchanged', () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <BrandHeader brand={fixtureBrand} />
      </NextIntlClientProvider>
    )

    // Proper noun (brand name) is unchanged
    expect(screen.getByText('Sunrise Tea')).toBeInTheDocument()

    // Owner badge uses updated English label and tooltip from brandDetail
    expect(screen.getByText('Brand-managed')).toBeInTheDocument()
    expect(screen.getByTitle('Managed by the brand owner')).toBeInTheDocument()

    // Founding year uses English translation key (brandDetail.foundingYear)
    expect(screen.getByText('Est. 2010')).toBeInTheDocument()
  })
})
