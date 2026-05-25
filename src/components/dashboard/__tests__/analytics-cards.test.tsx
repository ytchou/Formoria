// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AnalyticsCards } from '../analytics-cards'

describe('AnalyticsCards', () => {
  it('displays total views and clicks', () => {
    render(
      <AnalyticsCards
        totalViews={142}
        totalClicks={18}
        viewTrend="up"
        clickTrend="flat"
      />
    )
    expect(screen.getByText('142')).toBeInTheDocument()
    expect(screen.getByText('18')).toBeInTheDocument()
  })

  it('shows an up arrow for upward trend', () => {
    render(
      <AnalyticsCards totalViews={100} totalClicks={5} viewTrend="up" clickTrend="down" />
    )
    expect(screen.getByLabelText('Views trending up')).toBeInTheDocument()
    expect(screen.getByLabelText('Clicks trending down')).toBeInTheDocument()
  })

  it('shows a dash for flat trend', () => {
    render(
      <AnalyticsCards totalViews={0} totalClicks={0} viewTrend="flat" clickTrend="flat" />
    )
    expect(screen.getAllByLabelText('Trending flat')).toHaveLength(2)
  })

  it('renders last 30 days label', () => {
    render(
      <AnalyticsCards totalViews={0} totalClicks={0} viewTrend="flat" clickTrend="flat" />
    )
    expect(screen.getAllByText(/last 30 days/i)).toHaveLength(2)
  })
})
