// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SourcesBreakdownCard } from '../sources-breakdown-card'

describe('SourcesBreakdownCard', () => {
  it('renders a row per source with percentage of total', () => {
    render(
      <SourcesBreakdownCard
        sources={[
          { source: 'direct', views: 42 },
          { source: 'external_search', views: 28 },
          { source: 'category', views: 30 },
        ]}
      />,
    )
    expect(screen.getByText('Traffic Sources')).toBeInTheDocument()
    expect(screen.getByText('Direct')).toBeInTheDocument()
    expect(screen.getByText('External search')).toBeInTheDocument()
    expect(screen.getByText('42%')).toBeInTheDocument()
    expect(screen.getByText('30%')).toBeInTheDocument()
  })

  it('renders the empty state when there is no data', () => {
    render(<SourcesBreakdownCard sources={[]} />)
    expect(screen.getByText('No traffic data yet')).toBeInTheDocument()
  })

  it('labels the unknown bucket as Other', () => {
    render(<SourcesBreakdownCard sources={[{ source: 'unknown', views: 5 }]} />)
    expect(screen.getByText('Other')).toBeInTheDocument()
  })
})
