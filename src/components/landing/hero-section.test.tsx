// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import zhMessages from '../../../messages/zh-TW.json'

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode; [key: string]: unknown }) => <a href={href} {...props}>{children}</a>,
}))

vi.mock('@/components/brands/search-input', () => ({
  SearchInput: ({ placeholder }: { placeholder?: string }) => <input role="searchbox" placeholder={placeholder} />,
}))

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn().mockResolvedValue((key: string) => {
    const messages = zhMessages.landing.hero as Record<string, string>
    return messages[key] ?? key
  }),
  getLocale: vi.fn().mockResolvedValue('zh-TW'),
}))

import HeroSection from './hero-section'

describe('HeroSection', () => {
  it('renders the main heading', async () => {
    render(await HeroSection({ brandCount: 100, categoryCount: 20, recentBrands: { count: 5, period: '7d' } }))
    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading).toBeInTheDocument()
  })

  it('renders search input', async () => {
    render(await HeroSection({ brandCount: 100, categoryCount: 20, recentBrands: { count: 5, period: '7d' } }))
    expect(screen.getByRole('searchbox')).toBeInTheDocument()
  })

  it('renders trust stats line', async () => {
    render(await HeroSection({ brandCount: 100, categoryCount: 20, recentBrands: { count: 5, period: '7d' } }))
    expect(screen.getByText(/100/)).toBeInTheDocument()
  })
})
