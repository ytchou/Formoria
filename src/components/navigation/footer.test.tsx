// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { Footer } from './footer'

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

describe('Footer', () => {
  it('renders a semantic footer element', () => {
    render(<Footer />)
    expect(screen.getByRole('contentinfo')).toBeInTheDocument()
  })

  it('renders 關於我們 link pointing to /about', () => {
    render(<Footer />)
    expect(screen.getByRole('link', { name: '關於我們' })).toHaveAttribute('href', '/about')
  })

  it('renders 服務條款 link pointing to /terms', () => {
    render(<Footer />)
    expect(screen.getByRole('link', { name: '服務條款' })).toHaveAttribute('href', '/terms')
  })

  it('renders 聯絡我們 as a mailto link', () => {
    render(<Footer />)
    const link = screen.getByRole('link', { name: '聯絡我們' })
    expect(link.getAttribute('href')).toMatch(/^mailto:/)
  })

  it('renders copyright text containing Formoria', () => {
    render(<Footer />)
    expect(screen.getByText(/Formoria/)).toBeInTheDocument()
  })
})
