// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import type { ReactNode } from 'react'
import en from '@/../messages/en.json'
import { AnalyticsCards } from '../analytics-cards'

const wrap = (ui: ReactNode) => (
  <NextIntlClientProvider locale="en" messages={en}>
    {ui}
  </NextIntlClientProvider>
)

describe('AnalyticsCards', () => {
  it('displays total views and clicks', () => {
    render(
      wrap(
        <AnalyticsCards
          totalViews={142}
          totalClicks={18}
          viewTrend="up"
          clickTrend="flat"
        />
      )
    )
    expect(screen.getByText('142')).toBeInTheDocument()
    expect(screen.getByText('18')).toBeInTheDocument()
  })

  it('shows an up arrow for upward trend', () => {
    render(
      wrap(
        <AnalyticsCards
          totalViews={100}
          totalClicks={5}
          viewTrend="up"
          clickTrend="down"
        />
      )
    )
    expect(screen.getByLabelText('Trending up')).toBeInTheDocument()
    expect(screen.getByLabelText('Trending down')).toBeInTheDocument()
  })

  it('shows a dash for flat trend', () => {
    render(
      wrap(
        <AnalyticsCards
          totalViews={0}
          totalClicks={0}
          viewTrend="flat"
          clickTrend="flat"
        />
      )
    )
    expect(screen.getAllByLabelText('No change')).toHaveLength(2)
  })

  it('renders localized labels', () => {
    render(
      wrap(
        <AnalyticsCards
          totalViews={10}
          totalClicks={3}
          viewTrend="up"
          clickTrend="flat"
        />
      )
    )
    expect(screen.getByText('Page Views')).toBeInTheDocument()
    expect(screen.getByText('Outbound Clicks')).toBeInTheDocument()
    expect(screen.getAllByText('Last 30 days')).toHaveLength(2)
  })

  it('shows a good CTR benchmark when CTR is at least 3%', () => {
    render(
      wrap(
        <AnalyticsCards
          totalViews={100}
          totalClicks={6}
          viewTrend="flat"
          clickTrend="flat"
        />
      )
    )

    expect(screen.getByText('Good · ≥3% CTR')).toBeInTheDocument()
  })

  it('shows a room to grow CTR benchmark when CTR is below 3%', () => {
    render(
      wrap(
        <AnalyticsCards
          totalViews={100}
          totalClicks={2}
          viewTrend="flat"
          clickTrend="flat"
        />
      )
    )

    expect(screen.getByText('Room to grow · <3% CTR')).toBeInTheDocument()
  })

  it('shows a trending up benchmark when views are trending up', () => {
    render(
      wrap(
        <AnalyticsCards
          totalViews={100}
          totalClicks={2}
          viewTrend="up"
          clickTrend="flat"
        />
      )
    )

    expect(screen.getByText('Trending up')).toBeInTheDocument()
  })
})
