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
