// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'

describe('MasonryGrid', () => {
  it('renders children in a masonry layout', async () => {
    const { MasonryGrid } = await import('./masonry-grid')
    render(
      <MasonryGrid>
        <div data-testid="item-1">Item 1</div>
        <div data-testid="item-2">Item 2</div>
        <div data-testid="item-3">Item 3</div>
      </MasonryGrid>
    )
    expect(screen.getByTestId('item-1')).toBeInTheDocument()
    expect(screen.getByTestId('item-2')).toBeInTheDocument()
    expect(screen.getByTestId('item-3')).toBeInTheDocument()
  })

  it('renders with masonry container class', async () => {
    const { MasonryGrid } = await import('./masonry-grid')
    const { container } = render(
      <MasonryGrid>
        <div>Item</div>
      </MasonryGrid>
    )
    expect(container.querySelector('.masonry-grid')).toBeInTheDocument()
  })
})
