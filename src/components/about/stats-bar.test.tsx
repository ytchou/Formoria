// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { describe, it, expect } from 'vitest'
import enMessages from '../../../messages/en.json'
import StatsBar from './stats-bar'

function renderStatsBar({
  brandCount = 42,
  categoryCount = 8,
  brandUnit = 'brands',
  categoryUnit = 'categories',
} = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <StatsBar
        brandCount={brandCount}
        categoryCount={categoryCount}
        brandUnit={brandUnit}
        categoryUnit={categoryUnit}
      />
    </NextIntlClientProvider>,
  )
}

describe('StatsBar', () => {
  it('renders brand, category, and curated stats', () => {
    renderStatsBar()

    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.getByText('8')).toBeInTheDocument()
    expect(screen.getByText('100%')).toBeInTheDocument()
  })

  it('renders descriptive labels for all three stats', () => {
    renderStatsBar({ brandCount: 10, categoryCount: 3 })

    expect(screen.getByText('brands')).toBeInTheDocument()
    expect(screen.getByText('categories')).toBeInTheDocument()
    expect(screen.getByText('community curated')).toBeInTheDocument()
  })

  it('renders zero counts without crashing', () => {
    renderStatsBar({ brandCount: 0, categoryCount: 0 })

    const zeros = screen.getAllByText('0')
    expect(zeros.length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('100%')).toBeInTheDocument()
  })
})
