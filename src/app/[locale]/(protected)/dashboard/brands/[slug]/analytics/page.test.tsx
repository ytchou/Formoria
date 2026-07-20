// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireBrandEditor: vi.fn(),
  getSnapshot: vi.fn(),
  redirect: vi.fn(),
}))

vi.mock('next-intl/server', () => ({
  setRequestLocale: vi.fn(),
  getTranslations: vi.fn(async () => (key: string, values?: { change?: string }) => ({
    profileSessions: 'Profile sessions',
    outboundSessions: 'Outbound sessions',
    outboundConversion: 'Outbound conversion',
    collectingBaseline: 'Collecting comparison baseline',
    priorChangeUnavailable: 'Prior-period change unavailable',
    currentRateUnavailable: 'Current rate unavailable',
    versusPrior: `${values?.change} vs prior 30 days`,
    conversionDefinition: 'Outbound sessions ÷ profile sessions',
    sessionTrend: '30-day session trend',
    sessionTrendDescription: 'Profile sessions with outbound sessions shown in the tooltip.',
    openPostHog: 'Open in PostHog',
    sessionTrendAria: 'Daily profile and outbound sessions',
    trendUnavailable: 'Daily trend is temporarily unavailable.',
    acquisitionSources: 'Acquisition sources',
    acquisitionUnavailable: 'Acquisition is temporarily unavailable.',
    outboundDestinations: 'Outbound destinations',
    destinationsUnavailable: 'Destinations are temporarily unavailable.',
    source: 'Source',
    dataThrough: 'Data through',
    generated: 'Generated',
    unavailableTitle: 'Analytics temporarily unavailable',
    unavailableBody: 'PostHog could not load this brand’s session metrics. Try again later.',
  }[key] ?? key)),
}))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
vi.mock('@/lib/auth/require-brand-editor', () => ({ requireBrandEditor: mocks.requireBrandEditor }))
vi.mock('@/lib/services/posthog-owner-analytics', () => ({ getPostHogOwnerAnalyticsSnapshot: mocks.getSnapshot }))
vi.mock('@/components/dashboard/brand-dashboard-shell', () => ({ BrandDashboardShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }))

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
  daily: [],
  acquisition: [{ source: 'Direct', medium: 'direct', sessions: 10 }],
  destinations: [{ destination: 'website', sessions: 8 }],
  completeness: { comparisonReady: true, availableFrom: '2026-05-01', warnings: [] },
  sourceUrl: 'https://us.posthog.com/project/123/dashboard/456',
}

describe('owner analytics page authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSnapshot.mockResolvedValue(snapshot)
  })

  it.each([
    ['notLoggedIn', '/auth/sign-in'],
    ['forbidden', '/en/dashboard'],
  ] as const)('never queries PostHog when editor authorization returns %s', async (error, destination) => {
    mocks.requireBrandEditor.mockResolvedValue({ error })
    const page = await AnalyticsPage({ params: Promise.resolve({ locale: 'en', slug: 'alpha' }) })
    render(page)

    expect(mocks.redirect).toHaveBeenCalledWith(destination)
    expect(mocks.getSnapshot).not.toHaveBeenCalled()
  })

  it.each([
    { owner: true, actingAdmin: false },
    { owner: false, actingAdmin: true },
  ])('queries PostHog after owner/admin authorization', async (authorization) => {
    mocks.requireBrandEditor.mockResolvedValue({
      user: { id: 'user-1' },
      brand: { id: 'brand-uuid', name: 'Alpha', slug: 'alpha' },
      configuredAdmin: authorization.actingAdmin,
      ...authorization,
    })
    render(await AnalyticsPage({ params: Promise.resolve({ locale: 'en', slug: 'alpha' }) }))

    expect(mocks.getSnapshot).toHaveBeenCalledWith('brand-uuid')
    expect(screen.getByText('Profile sessions')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open in PostHog' })).toHaveAttribute(
      'href',
      snapshot.sourceUrl,
    )
  })
})
