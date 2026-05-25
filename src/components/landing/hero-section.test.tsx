// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/components/brands/search-input', () => ({
  SearchInput: ({ redirectTo, placeholder }: { redirectTo?: string; placeholder?: string }) => (
    <input role="searchbox" placeholder={placeholder ?? ''} data-redirect={redirectTo} />
  ),
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode; [key: string]: unknown }) => <a href={href} {...props}>{children}</a>,
}))

import HeroSection from './hero-section'

describe('HeroSection', () => {
  it('renders the main heading', () => {
    render(<HeroSection />)
    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading).toBeInTheDocument()
  })

  it('renders SearchInput with redirect to /brands', () => {
    render(<HeroSection />)
    const searchbox = screen.getByRole('searchbox')
    expect(searchbox).toBeInTheDocument()
    expect(searchbox).toHaveAttribute('data-redirect', '/brands')
  })

  it('renders CTA link to /brands', () => {
    render(<HeroSection />)
    const link = screen.getByRole('link', { name: /探索品牌/ })
    expect(link).toHaveAttribute('href', '/brands')
  })
})
