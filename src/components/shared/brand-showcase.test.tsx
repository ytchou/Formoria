// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/components/brands/brand-card', () => ({
  BrandCard: ({ brand }: { brand: { name: string } }) => (
    <div data-testid="brand-card">{brand.name}</div>
  ),
}))

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode; [key: string]: unknown }) => <a href={href} {...props}>{children}</a>,
}))

import BrandShowcase from './brand-showcase'

const mockBrands = [
  { id: '1', name: '茶籽堂', slug: 'cha-zi-tang', description: '苦茶籽品牌', category: 'beauty', heroImageUrl: null, website: 'https://example.com', foundedYear: 2004, approvedAt: '2026-01-15', verifiedAt: null, socialLinks: {}, isApproved: true, isHidden: false },
  { id: '2', name: '春一枝', slug: 'chun-yi-zhi', description: '天然水果冰棒', category: 'food', heroImageUrl: null, website: null, foundedYear: 2008, approvedAt: '2026-02-20', verifiedAt: null, socialLinks: {}, isApproved: true, isHidden: false },
]

describe('BrandShowcase', () => {
  it('renders heading and brand cards', () => {
    render(
      <BrandShowcase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        brands={mockBrands as any}
        heading="探索品牌"
        linkText="瀏覽全部品牌"
        linkHref="/brands"
      />
    )

    expect(screen.getByText('探索品牌')).toBeInTheDocument()
    expect(screen.getByText('瀏覽全部品牌')).toBeInTheDocument()
    expect(screen.getAllByTestId('brand-card')).toHaveLength(2)
  })

  it('renders nothing when brands array is empty', () => {
    const { container } = render(
      <BrandShowcase
        brands={[]}
        heading="探索品牌"
        linkText="瀏覽全部品牌"
        linkHref="/brands"
      />
    )

    expect(container.innerHTML).toBe('')
  })

  it('renders link to view all brands', () => {
    render(
      <BrandShowcase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        brands={mockBrands as any}
        heading="探索品牌"
        linkText="瀏覽全部品牌"
        linkHref="/brands"
      />
    )

    const link = screen.getByRole('link', { name: /瀏覽全部品牌/ })
    expect(link).toHaveAttribute('href', '/brands')
  })
})
