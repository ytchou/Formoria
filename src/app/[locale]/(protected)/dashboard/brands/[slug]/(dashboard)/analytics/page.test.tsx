// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getBrandBySlug: vi.fn(),
  getSnapshot: vi.fn(),
}))

vi.mock('next-intl', () => ({
  useTranslations: vi.fn(() => (key: string) => key),
}))

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/dashboard/brands/alpha/analytics'),
  useRouter: vi.fn(() => ({ replace: vi.fn() })),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}))

vi.mock('next-intl/server', () => ({
  setRequestLocale: vi.fn(),
  getTranslations: vi.fn(async () => (key: string, values?: { change?: string; share?: number }) => ({
    profileVisits: 'Profile visits',
    outboundClicks: 'Outbound clicks',
    outboundClickRate: 'Outbound click rate',
    topTrafficSource: 'Top traffic source',
    shareOfVisits: `${values?.share}% of visits`,
    tooltipProfileVisits: 'Unique browsing sessions that opened your brand page in the last 30 days.',
    tooltipOutboundClicks: 'Sessions where a visitor clicked an external link from your brand page.',
    tooltipOutboundClickRate: 'Outbound clicks ÷ profile visits.',
    tooltipTopTrafficSource: 'The most common way visitors find your brand page.',
    collectingBaseline: 'Collecting comparison baseline',
    priorChangeUnavailable: 'Prior-period change unavailable',
    currentRateUnavailable: 'Current rate unavailable',
    versusPrior: `${values?.change} vs prior 30 days`,
    conversionDefinition: 'Outbound clicks ÷ profile visits',
    trendTitle: '30-day traffic trend',
    trendAria: '30-day traffic trend chart',
    trendUnavailable: 'Daily trend is temporarily unavailable.',
    trendEmpty: 'No profile sessions in this window.',
    trafficSources: 'Traffic sources',
    trafficSourceSearch: 'Search',
    trafficSourceCategory: 'Category pages',
    trafficSourceHomepage: 'Homepage',
    trafficSourceDirect: 'Direct',
    trafficSourceOther: 'Other',
    trafficSourcesUnavailable: 'Traffic sources are temporarily unavailable.',
    trafficSourcesEmpty: 'No traffic source data in this window.',
    outboundDestinations: 'Outbound destinations',
    destinationsUnavailable: 'Destinations are temporarily unavailable.',
    destinationsEmpty: 'No outbound sessions in this window.',
    sectionUnavailable: 'This section is temporarily unavailable.',
    nudgeTitle: 'Keep growing your visibility',
    nudgeBody: 'Claim and complete your brand profile to appear in more searches and category pages.',
    dataThrough: 'Data through',
    generated: 'Generated',
    unavailableTitle: 'Analytics temporarily unavailable',
    unavailableBody: "Analytics could not load this brand's session metrics. Try again later.",
    last30Days: 'Last 30 days',
    trendUp: 'Trending up',
    trendDown: 'Trending down',
    trendFlat: 'No change',
  }[key] ?? key)),
}))
vi.mock('@/lib/services/brands', () => ({ getBrandBySlug: mocks.getBrandBySlug }))
vi.mock('@/lib/services/posthog-owner-analytics', () => ({ getPostHogOwnerAnalyticsSnapshot: mocks.getSnapshot }))

import AnalyticsPage from './page'

const snapshot = {
  schemaVersion: 1,
  generatedAt: '2026-07-20T00:00:00.000Z',
  dataThrough: '2026-07-19',
  timeZone: 'Asia/Taipei',
  windows: {
    current: { startDate: '2026-06-20', endDate: '2026-07-19' },
    prior: { startDate: '2026-05-21', endDate: '2026-06-19' },
    trend: { startDate: '2026-06-20', endDate: '2026-07-19' },
  },
  profileSessions: { current: 30, prior: 20 },
  outboundSessions: { current: 12, prior: 5 },
  outboundConversion: { current: 0.4, prior: 0.25 },
  daily: [
    { date: '2026-07-18', profileSessions: 10, outboundSessions: 3 },
    { date: '2026-07-19', profileSessions: 20, outboundSessions: 9 },
  ],
  trafficSources: [
    { source: 'search', sessions: 525 },
    { source: 'category', sessions: 349 },
  ],
  topTrafficSource: { source: 'search', share: 0.42 },
  destinations: [{ destination: 'website', sessions: 8 }],
  completeness: { comparisonReady: true, availableFrom: '2026-05-01', warnings: [] },
}

describe('owner analytics page data loading', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getBrandBySlug.mockResolvedValue({ id: 'brand-uuid', name: 'Alpha', slug: 'alpha' })
    mocks.getSnapshot.mockResolvedValue(snapshot)
  })

  it('queries analytics for the routed brand', async () => {
    render(await AnalyticsPage({ params: Promise.resolve({ locale: 'en', slug: 'alpha' }) }))

    expect(mocks.getBrandBySlug).toHaveBeenCalledWith('alpha')
    expect(mocks.getSnapshot).toHaveBeenCalledWith('brand-uuid', { daysBack: 30 })
    expect(screen.getAllByText('Profile visits')).toHaveLength(2)
  })
})

describe('owner analytics page content', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getBrandBySlug.mockResolvedValue({ id: 'brand-uuid', name: 'Alpha', slug: 'alpha' })
    mocks.getSnapshot.mockResolvedValue(snapshot)
  })

  it('renders four KPI cards with deltas and definition tooltips', async () => {
    render(await AnalyticsPage({ params: Promise.resolve({ locale: 'en', slug: 'alpha' }) }))

    expect(screen.getAllByText('Profile visits')).toHaveLength(2)
    expect(screen.getAllByText('Outbound clicks')).toHaveLength(2)
    expect(screen.getByText('Outbound click rate')).toBeInTheDocument()
    expect(screen.getByText('Top traffic source')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /definition/i })).toHaveLength(4)
    expect(screen.getByText('↑ 50%')).toBeInTheDocument()
    expect(screen.getByText('↑ 140%')).toBeInTheDocument()
    expect(screen.getByText('↑ 15.0pp')).toBeInTheDocument()
    expect(screen.getByText('42% of visits')).toBeInTheDocument()
  })

  it('renders the trend chart, both breakdown cards, and nudge footer', async () => {
    render(await AnalyticsPage({ params: Promise.resolve({ locale: 'en', slug: 'alpha' }) }))

    expect(screen.getByRole('img', { name: '30-day traffic trend chart' })).toBeInTheDocument()
    expect(screen.getByText('Traffic sources')).toBeInTheDocument()
    expect(screen.getAllByText('Search')).toHaveLength(2)
    expect(screen.getByText('Outbound destinations')).toBeInTheDocument()
    expect(screen.getByText('website')).toBeInTheDocument()
    expect(screen.getByText('Keep growing your visibility')).toBeInTheDocument()
    expect(screen.getByText('Data through · 2026-07-19')).toBeInTheDocument()
  })

  it('never renders the analytics provider name anywhere', async () => {
    const { container } = render(
      await AnalyticsPage({ params: Promise.resolve({ locale: 'en', slug: 'alpha' }) }),
    )

    expect(container.textContent?.toLowerCase()).not.toContain(['post', 'hog'].join(''))
  })

  it('shows a section-unavailable state when traffic sources are null', async () => {
    mocks.getSnapshot.mockResolvedValue({ ...snapshot, trafficSources: null })

    render(await AnalyticsPage({ params: Promise.resolve({ locale: 'en', slug: 'alpha' }) }))

    expect(screen.getByText('This section is temporarily unavailable.')).toBeInTheDocument()
  })

  it('distinguishes available zero-result breakdowns from provider failures', async () => {
    mocks.getSnapshot.mockResolvedValue({
      ...snapshot,
      daily: [{ date: '2026-07-19', profileSessions: 0, outboundSessions: 0 }],
      trafficSources: [],
      destinations: [],
    })

    render(await AnalyticsPage({ params: Promise.resolve({ locale: 'en', slug: 'alpha' }) }))

    expect(screen.getByText('No profile sessions in this window.')).toBeInTheDocument()
    expect(screen.getByText('No traffic source data in this window.')).toBeInTheDocument()
    expect(screen.getByText('No outbound sessions in this window.')).toBeInTheDocument()
    expect(screen.queryByText('Daily trend is temporarily unavailable.')).not.toBeInTheDocument()
  })
})
