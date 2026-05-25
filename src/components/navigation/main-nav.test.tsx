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

describe('MainNav', () => {
  it('renders logo with MIT Map text', async () => {
    const { MainNav } = await import('./main-nav')
    render(<MainNav />)
    expect(screen.getByText('MIT Map')).toBeInTheDocument()
  })

  it('renders navigation links', async () => {
    const { MainNav } = await import('./main-nav')
    render(<MainNav />)
    expect(screen.getByRole('link', { name: /瀏覽/ })).toHaveAttribute(
      'href',
      '/'
    )
    expect(screen.getByRole('link', { name: /關於/ })).toHaveAttribute(
      'href',
      '/about'
    )
  })

  it('renders Submit a Brand CTA', async () => {
    const { MainNav } = await import('./main-nav')
    render(<MainNav />)
    expect(screen.getByRole('link', { name: '提交品牌' })).toHaveAttribute(
      'href',
      '/submit'
    )
  })

  it('renders My Submissions nav link', async () => {
    const { MainNav } = await import('./main-nav')
    render(<MainNav />)
    expect(screen.getAllByRole('link', { name: '我的提交' })[0]).toHaveAttribute(
      'href',
      '/my-submissions'
    )
  })

  it('renders mobile menu button on small screens', async () => {
    const { MainNav } = await import('./main-nav')
    render(<MainNav />)
    expect(screen.getByRole('button', { name: /menu/i })).toBeInTheDocument()
  })
})
