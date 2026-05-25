// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    className,
  }: {
    children: React.ReactNode
    href: string
    className?: string
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
}))

vi.mock('./nav-search-input', () => ({
  NavSearchInput: () => <div data-testid="nav-search-input" />,
}))

vi.mock('./nav-category-tabs', () => ({
  NavCategoryTabs: () => <div data-testid="nav-category-tabs" />,
}))

const mockCategories = [
  { slug: 'food', name: 'Food', nameZh: '食品' },
  { slug: 'fashion', name: 'Fashion', nameZh: '時尚' },
]

describe('MainNav', () => {
  it('renders logo with MIT Map text', async () => {
    const { MainNav } = await import('./main-nav')
    render(<MainNav categories={mockCategories} />)
    expect(screen.getByText('MIT Map')).toBeInTheDocument()
  })

  it('renders navigation links', async () => {
    const { MainNav } = await import('./main-nav')
    render(<MainNav categories={mockCategories} />)
    expect(screen.getByRole('link', { name: /品牌目錄/ })).toHaveAttribute(
      'href',
      '/brands'
    )
  })

  it('renders Submit a Brand CTA', async () => {
    const { MainNav } = await import('./main-nav')
    render(<MainNav categories={mockCategories} />)
    expect(screen.getByRole('link', { name: '提交品牌' })).toHaveAttribute(
      'href',
      '/submit'
    )
  })

  it('renders My Submissions nav link', async () => {
    const { MainNav } = await import('./main-nav')
    render(<MainNav categories={mockCategories} />)
    expect(screen.getAllByRole('link', { name: '我的提交' })[0]).toHaveAttribute(
      'href',
      '/my-submissions'
    )
  })

  it('renders mobile menu button on small screens', async () => {
    const { MainNav } = await import('./main-nav')
    render(<MainNav categories={mockCategories} />)
    expect(screen.getByRole('button', { name: /menu/i })).toBeInTheDocument()
  })
})
