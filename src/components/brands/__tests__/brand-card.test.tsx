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

function makeBrand(overrides: Partial<Brand> = {}): Brand {
  return {
    id: 'brand-1',
    name: 'Test Brand',
    slug: 'test-brand',
    description: 'A brand',
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
    tags: [],
    foundingYear: null,
    contactEmail: null,
    submittedAt: '2026-01-01T00:00:00Z',
    approvedAt: '2026-01-02T00:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function renderWithProvider(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      {ui}
    </NextIntlClientProvider>
  )
}

describe('BrandCard — verified badge', () => {
  it('renders a verified badge when isVerified is true', () => {
    renderWithProvider(<BrandCard brand={makeBrand({ isVerified: true })} />)
    expect(screen.getByLabelText('Managed by the brand owner')).toBeInTheDocument()
    expect(screen.getByText('Brand')).toBeInTheDocument()
    expect(screen.queryByText('Community')).not.toBeInTheDocument()
  })

  it('renders a community label when isVerified is false', () => {
    renderWithProvider(<BrandCard brand={makeBrand({ isVerified: false })} />)
    expect(screen.queryByLabelText('Managed by the brand owner')).not.toBeInTheDocument()
    expect(screen.getByText('Community')).toBeInTheDocument()
  })
})
