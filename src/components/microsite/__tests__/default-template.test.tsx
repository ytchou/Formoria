// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DefaultTemplate } from '@/components/microsite/templates/default-template'
import type { Brand, SiteContent } from '@/lib/types/brand'

const brand = {
  name: 'Warmwood 溫木',
  slug: 'warmwood-living',
  heroImageUrl: 'https://x.supabase.co/hero.jpg',
  mitVerified: true,
  contactEmail: 'hi@warmwood.tw',
} as Brand
const siteContent = {
  template: 'default',
  tokens: { accent: '#7C5C3E', accentForeground: '#FFFFFF' },
  tagline: '溫潤木作，日常的溫度',
  story: '我們在台中的小工坊…',
  products: [{ name: '核桃木托盤', imageUrl: 'https://x.supabase.co/p.jpg', url: 'https://shopee.tw/x', caption: '手工打磨' }],
  ctaType: 'mailto',
  ctaValue: 'hi@warmwood.tw',
} as SiteContent

describe('DefaultTemplate (microsite)', () => {
  it('renders brand identity, story, products, mailto CTA, and Formoria footer mark', () => {
    render(<DefaultTemplate brand={brand} siteContent={siteContent} />)
    expect(screen.getByText('Warmwood 溫木')).toBeInTheDocument()
    expect(screen.getByText('溫潤木作，日常的溫度')).toBeInTheDocument()
    expect(screen.getByText(/小工坊/)).toBeInTheDocument()
    expect(screen.getByText('核桃木托盤')).toBeInTheDocument()
    const mailto = screen.getByRole('link', { name: /洽詢|聯絡品牌/ })
    expect(mailto).toHaveAttribute('href', 'mailto:hi@warmwood.tw')
    expect(screen.getByText(/MIT 微笑認證/)).toBeInTheDocument()
    expect(screen.getByText(/Powered by Formoria/i)).toBeInTheDocument()
  })

  it('applies the swappable accent as a CSS variable at the root', () => {
    const { container } = render(<DefaultTemplate brand={brand} siteContent={siteContent} />)
    const root = container.firstElementChild as HTMLElement
    expect(root.style.getPropertyValue('--brand-accent')).toBe('#7C5C3E')
  })
})
