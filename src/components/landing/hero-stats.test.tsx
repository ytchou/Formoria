/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { HeroStats } from './hero-stats'

// AnimatedNumber counts up via requestAnimationFrame, which would make the
// rendered digits time-dependent. Reduced motion makes it settle on the final
// value synchronously, so assertions stay deterministic.
function stubReducedMotion() {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList =>
      ({
        matches: true,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList,
  })
}

describe('HeroStats', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    stubReducedMotion()
  })

  it('renders a genuine zero brand count with its separator', () => {
    const { container } = render(
      <HeroStats
        brandCount={0}
        brandLabel="brands"
        categoryCount={12}
        categoryLabel="categories"
      />,
    )

    expect(screen.getByText('0')).toBeInTheDocument()
    expect(container).toHaveTextContent('brands')
    expect(container.textContent).toContain('·')
  })

  it('drops the figure and the dangling separator when the count is unknown', () => {
    const { container } = render(
      <HeroStats
        brandCount={undefined}
        brandLabel="brands"
        categoryCount={12}
        categoryLabel="categories"
      />,
    )

    expect(screen.queryByText('0')).not.toBeInTheDocument()
    expect(container).not.toHaveTextContent('brands')
    expect(container.textContent).not.toContain('·')
  })

  it('renders the category count whether or not the brand count is known', () => {
    const { container: withBrands } = render(
      <HeroStats
        brandCount={0}
        brandLabel="brands"
        categoryCount={12}
        categoryLabel="categories"
      />,
    )
    expect(withBrands).toHaveTextContent('12 categories')

    const { container: withoutBrands } = render(
      <HeroStats
        categoryCount={12}
        brandLabel="brands"
        categoryLabel="categories"
      />,
    )
    expect(withoutBrands).toHaveTextContent('12 categories')
  })
})
