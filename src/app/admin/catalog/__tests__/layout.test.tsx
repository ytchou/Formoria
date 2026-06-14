// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

describe('CatalogLayout', () => {
  it('renders children', async () => {
    const { default: Layout } = await import('../layout')
    render(Layout({ children: <div data-testid="child">content</div> }))
    expect(screen.getByTestId('child')).toBeInTheDocument()
  })
})
