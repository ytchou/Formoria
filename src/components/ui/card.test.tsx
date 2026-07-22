// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  DataCard,
  InfoField,
  InfoGroup,
  SurfaceCard,
  surfaceCardStyles,
} from './card'

describe('SurfaceCard', () => {
  it('uses a flat bordered card surface by default', () => {
    render(<SurfaceCard>Content</SurfaceCard>)

    expect(screen.getByText('Content')).toHaveClass(
      'rounded-xl',
      'border',
      'border-border',
      'bg-card',
      'shadow-none',
    )
  })

  it('supports padding and interactive variants', () => {
    render(
      <SurfaceCard padding="lg" interactive>
        Interactive
      </SurfaceCard>,
    )

    expect(screen.getByText('Interactive')).toHaveClass(
      'p-6',
      'hover:-translate-y-px',
      'hover:shadow-card-hover',
      'focus-visible:ring-2',
    )
  })

  it('supports the semantic information tone', () => {
    render(<SurfaceCard tone="info">Information</SurfaceCard>)

    expect(screen.getByText('Information')).toHaveClass(
      'border-info/30',
      'bg-info-bg',
      'text-info',
    )
  })
})

describe('surfaceCardStyles', () => {
  it('returns reusable shell classes for non-component callers', () => {
    expect(surfaceCardStyles({ padding: 'sm', tone: 'white' })).toContain(
      'bg-white',
    )
    expect(surfaceCardStyles({ padding: 'sm', tone: 'white' })).toContain(
      'p-4',
    )
  })
})

describe('DataCard', () => {
  it('applies standard metric label, value, and description typography', () => {
    render(
      <DataCard label="Page views" value="142" description="Last 30 days" />,
    )

    expect(screen.getByText('Page views')).toHaveClass('type-metadata')
    expect(screen.getByText('142')).toHaveClass('type-stat')
    expect(screen.getByText('Last 30 days')).toHaveClass(
      'type-card-description',
    )
  })

  it('DataCard renders an optional delta line with direction tone', () => {
    render(
      <DataCard
        label="Profile visits"
        value="1,248"
        delta={{ text: '↑ 18% vs previous 30 days', direction: 'up' }}
      />,
    )
    const delta = screen.getByText('↑ 18% vs previous 30 days')
    expect(delta).toBeInTheDocument()
    expect(delta).toHaveAttribute('data-direction', 'up')
  })

  it('DataCard without delta renders exactly as before', () => {
    render(<DataCard label="Pending" value="4" description="awaiting review" />)
    expect(screen.getByText('awaiting review')).toBeInTheDocument()
    expect(document.querySelector('[data-direction]')).toBeNull()
  })
})

describe('InfoField', () => {
  it('applies standard information label and value typography', () => {
    render(<InfoField label="Brand name" value="Warmwood Living" />)

    expect(screen.getByText('Brand name')).toHaveClass('type-field-label')
    expect(screen.getByText('Brand name')).toHaveClass('font-bold')
    expect(screen.getByText('Warmwood Living')).toHaveClass(
      'type-field-value',
      'break-words',
    )
  })
})

describe('InfoGroup', () => {
  it('uses bold field label typography for grouped information labels', () => {
    render(
      <InfoGroup label="Hero image" description="Shown on the public page">
        <div>Image preview</div>
      </InfoGroup>,
    )

    expect(screen.getByRole('heading', { name: 'Hero image' })).toHaveClass(
      'type-field-label',
      'font-bold',
    )
    expect(screen.getByText('Shown on the public page')).toHaveClass(
      'type-form-hint',
    )
  })
})
