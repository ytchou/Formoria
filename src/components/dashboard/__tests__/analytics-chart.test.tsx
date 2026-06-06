// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import en from '@/../messages/en.json'

vi.mock('next/dynamic', () => ({
  default: () => {
    function MockChart() {
      return null
    }

    return MockChart
  },
}))

vi.mock('@/components/ui/chart', () => ({
  ChartContainer: ({
    children,
    className,
  }: {
    children?: ReactNode
    className?: string
  }) => (
    <div
      className={className}
      data-testid="chart-container"
    >
      {children}
    </div>
  ),
  ChartTooltip: () => null,
  ChartTooltipContent: () => null,
}))

import { AnalyticsChart } from '../analytics-chart'

const series90 = Array.from({ length: 90 }, (_, i) => ({
  date: `2026-03-${i + 1}`,
  views: i,
  clicks: i % 5,
}))

const wrap = (ui: ReactNode) => (
  <NextIntlClientProvider
    locale="en"
    messages={en}
  >
    {ui}
  </NextIntlClientProvider>
)

describe('AnalyticsChart', () => {
  it('defaults to 30d and toggles to 90d without crashing', () => {
    render(wrap(<AnalyticsChart series={series90} />))

    const toggle = screen.getByRole('group', { name: /period/i })

    expect(within(toggle).getByRole('button', { name: '30d' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )

    fireEvent.click(within(toggle).getByRole('button', { name: '90d' }))

    expect(within(toggle).getByRole('button', { name: '90d' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  })

  it('renders both series labels from i18n', () => {
    render(wrap(<AnalyticsChart series={series90} />))

    expect(screen.getByText('Views')).toBeInTheDocument()
    expect(screen.getByText('Clicks')).toBeInTheDocument()
  })
})
