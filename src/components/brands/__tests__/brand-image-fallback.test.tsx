// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BrandImageFallback } from '../brand-image-fallback'

describe('BrandImageFallback', () => {
  it('renders brand initial', () => {
    render(<BrandImageFallback name="映沐生活" category="home" size="card" />)
    expect(screen.getByText('映')).toBeInTheDocument()
  })

  it('applies category tint as background', () => {
    const { container } = render(
      <BrandImageFallback name="TestBrand" category="tech" size="card" />,
    )
    const el = container.firstChild as HTMLElement
    expect(el.style.backgroundColor).toBe('oklch(0.935 0.022 240)')
  })

  it('uses Warm Surface for null category', () => {
    const { container } = render(
      <BrandImageFallback name="NoCat" category={null} size="card" />,
    )
    const el = container.firstChild as HTMLElement
    expect(el.style.backgroundColor).toBe('oklch(0.963 0.004 80)')
  })

  it('renders larger text for detail size', () => {
    render(<BrandImageFallback name="Big" category="fashion" size="detail" />)
    const el = screen.getByText('B')
    expect(el.className).toContain('text-5xl')
  })

  it('preserves data-testid for compatibility', () => {
    render(<BrandImageFallback name="Test" category="crafts" size="card" />)
    expect(screen.getByTestId('image-fallback')).toBeInTheDocument()
  })
})
