// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AnalyticsTrendChart } from './analytics-trend-chart'
import { AnalyticsDonutCard } from './analytics-donut-card'
import { AnalyticsBarChart } from './analytics-bar-chart'

const daily = [
  { date: '2026-07-01', profileSessions: 10, outboundSessions: 2 },
  { date: '2026-07-02', profileSessions: 14, outboundSessions: 3 },
]

describe('AnalyticsTrendChart', () => {
  it('renders an accessible chart region with both series in the legend', () => {
    render(
      <AnalyticsTrendChart
        data={daily}
        labels={{ profile: 'Profile visits', outbound: 'Outbound clicks', aria: '30-day traffic trend' }}
      />,
    )
    expect(screen.getByRole('img', { name: '30-day traffic trend' })).toBeInTheDocument()
    expect(screen.getByText('Profile visits')).toBeInTheDocument()
    expect(screen.getByText('Outbound clicks')).toBeInTheDocument()
  })
})

describe('AnalyticsDonutCard', () => {
  it('renders legend rows with share percentages and counts', () => {
    render(
      <AnalyticsDonutCard
        title='Traffic sources'
        rows={[
          { key: 'search', label: 'Search', sessions: 525 },
          { key: 'category', label: 'Category pages', sessions: 349 },
          { key: 'other', label: 'Other', sessions: 126 },
        ]}
        emptyLabel='No data yet'
      />,
    )
    expect(screen.getByText('Traffic sources')).toBeInTheDocument()
    expect(screen.getByText('Search')).toBeInTheDocument()
    expect(screen.getByText('53%')).toBeInTheDocument()
    expect(screen.getByText('525')).toBeInTheDocument()
  })

  it('renders the empty state when rows are empty', () => {
    render(<AnalyticsDonutCard title='Traffic sources' rows={[]} emptyLabel='No data yet' />)
    expect(screen.getByText('No data yet')).toBeInTheDocument()
  })

  it('donut card renders center label when provided', () => {
    render(
      <AnalyticsDonutCard
        title='Traffic sources'
        rows={[{ key: 'search', label: 'Search', sessions: 10 }]}
        emptyLabel='No data yet'
        centerLabel='72%'
      />,
    )

    expect(screen.getByText('72%')).toBeInTheDocument()
  })
})

describe('AnalyticsBarChart', () => {
  it('analytics bar chart renders bars with labels', () => {
    const { container } = render(
      <AnalyticsBarChart
        data={[
          { label: 'Official website', value: 12 },
          { label: 'Instagram', value: 8 },
        ]}
      />,
    )

    expect(container.querySelector('[data-slot="chart"]')).toBeInTheDocument()
    expect(screen.getByText('Official website')).toBeInTheDocument()
    expect(screen.getByText('Instagram')).toBeInTheDocument()
  })
})
