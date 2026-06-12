// @vitest-environment jsdom
import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BrandHealthCard } from '@/components/dashboard/brand-health-card'
import type { BrandHealthScore } from '@/lib/services/brand-health'
import type { BrandCompleteness } from '@/lib/services/brand-completeness'

// Mock next-intl Link (requires intl context at runtime)
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

// Mock next-intl
vi.mock('next-intl', () => ({
  useTranslations: (namespace?: string) => (key: string, values?: Record<string, unknown>) => {
    const fullKey = namespace ? `${namespace}.${key}` : key
    if (values) return `${fullKey}:${JSON.stringify(values)}`
    return fullKey
  },
}))

function makeHealthScore(overrides: Partial<BrandHealthScore> = {}): BrandHealthScore {
  return {
    overall: 58,
    tier: 'growing',
    dimensions: [
      { key: 'profileCompleteness', score: 78, weight: 0.25, coldStart: false },
      { key: 'engagementHealth', score: 0, weight: 0.15, coldStart: true },
      { key: 'brandStory', score: 66, weight: 0.15, coldStart: false },
      { key: 'photoQuality', score: 66, weight: 0.15, coldStart: false },
      { key: 'socialPresence', score: 50, weight: 0.10, coldStart: false },
      { key: 'purchaseAccessibility', score: 100, weight: 0.10, coldStart: false },
      { key: 'clickThroughRate', score: 0, weight: 0.10, coldStart: true },
    ],
    topActions: [
      { dimension: 'photoQuality', key: 'photoQuality', label: 'Add 2 more product photos', points: 8, anchor: '#product-photos', icon: 'camera' },
      { dimension: 'socialPresence', key: 'socialPresence', label: 'Link a social account', points: 5, anchor: '#social-links', icon: 'share-2' },
    ],
    ...overrides,
  }
}

function makeCompleteness(): BrandCompleteness {
  return {
    total: 9,
    completed: 7,
    fraction: 7 / 9,
    items: [
      { key: 'heroImage', complete: true, anchor: '#hero-image' },
      { key: 'description', complete: true, anchor: '#description' },
      { key: 'logo', complete: true, anchor: '#logo' },
      { key: 'purchaseLinks', complete: true, anchor: '#purchase-links' },
      { key: 'productPhotos', complete: true, anchor: '#product-photos' },
      { key: 'socialLinks', complete: true, anchor: '#social-links' },
      { key: 'brandHighlights', complete: true, anchor: '#brand-highlights' },
      { key: 'foundingYear', complete: false, anchor: '#founding-year' },
      { key: 'retailLocations', complete: false, anchor: '#retail-locations' },
    ],
    tier1Items: [],
    tier2Items: [],
  }
}

describe('BrandHealthCard', () => {
  const defaultProps = {
    health: makeHealthScore(),
    completeness: makeCompleteness(),
    slug: 'test-brand',
  }

  it('renders the overall score', async () => {
    render(BrandHealthCard(defaultProps))
    expect(screen.getByText('58')).toBeInTheDocument()
  })

  it('renders the benchmark tier label', async () => {
    render(BrandHealthCard(defaultProps))
    expect(screen.getByText(/dashboard\.health\.tier\.growing/)).toBeInTheDocument()
  })

  it('renders 7 dimension rows', async () => {
    render(BrandHealthCard(defaultProps))
    const rows = screen.getAllByTestId('health-dimension')
    expect(rows).toHaveLength(7)
  })

  it('shows cold-start badge for dimensions with coldStart=true', async () => {
    render(BrandHealthCard(defaultProps))
    const coldStartBadges = screen.getAllByText('dashboard.health.coldStart')
    expect(coldStartBadges).toHaveLength(2)
  })

  it('renders action nudges', async () => {
    render(BrandHealthCard(defaultProps))
    expect(screen.getByText('Add 2 more product photos')).toBeInTheDocument()
    expect(screen.getByText('Link a social account')).toBeInTheDocument()
  })

  it('renders the profile drill-down with 9 checklist items', async () => {
    render(BrandHealthCard(defaultProps))
    const items = screen.getAllByTestId('completeness-checklist-item')
    expect(items).toHaveLength(9)
  })

  it('renders Edit Profile link with correct href', async () => {
    render(BrandHealthCard(defaultProps))
    const editLink = screen.getByRole('link', { name: /dashboard\.health\.editProfile/ })
    expect(editLink).toHaveAttribute('href', '/dashboard/brands/test-brand/edit')
  })

  it('renders progress bars with role=progressbar and aria attributes', async () => {
    render(BrandHealthCard(defaultProps))
    const bars = screen.getAllByRole('progressbar')
    expect(bars.length).toBeGreaterThanOrEqual(7)
    const first = bars[0]
    expect(first).toHaveAttribute('aria-valuemin', '0')
    expect(first).toHaveAttribute('aria-valuemax', '100')
  })

  it('does not render action queue when no nudges available', async () => {
    render(BrandHealthCard({ ...defaultProps, health: makeHealthScore({ topActions: [] }) }))
    expect(screen.queryByText(/dashboard\.health\.actionQueue\.title/)).not.toBeInTheDocument()
  })
})
