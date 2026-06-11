// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { BrandCard } from '../brand-card'
import type { Brand } from '@/lib/types'
import en from '../../../../messages/en.json'

vi.mock('@/lib/analytics', () => ({
  trackBrandCardClicked: vi.fn(),
}))

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

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
    siteContent: null,
  tags: [],
  foundingYear: 2010,
  contactEmail: null,
  submittedAt: '2026-01-01T00:00:00Z',
  approvedAt: '2026-01-02T00:00:00Z',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

describe('BrandCard — English locale (i18n)', () => {
  it('renders English labels and keeps brand proper noun unchanged', () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <BrandCard brand={fixtureBrand} />
      </NextIntlClientProvider>
    )

    // Proper noun (brand name) is unchanged
    expect(screen.getByText('Sunrise Tea')).toBeInTheDocument()

    // Owner badge uses updated English short label and ARIA/title text
    expect(screen.getByLabelText('Managed by the brand owner')).toBeInTheDocument()
    expect(screen.getByText('Brand')).toBeInTheDocument()
  })
})
