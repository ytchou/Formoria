// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import zhMessages from '../../../messages/zh-TW.json'
import { trackHeroCategoryClicked } from '@/lib/analytics'

vi.mock('@/lib/analytics', () => ({
  trackHeroCategoryClicked: vi.fn(),
}))

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, onClick, ...props }: { href: string; children: React.ReactNode; onClick?: () => void; [key: string]: unknown }) => <a href={href} onClick={onClick} {...props}>{children}</a>,
}))

vi.mock('@/components/brands/search-input', () => ({
  SearchInput: ({ placeholder, redirectTo }: { placeholder?: string; redirectTo?: string }) => (
    <input role="searchbox" data-redirect-to={redirectTo} placeholder={placeholder} />
  ),
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
    expect(heading).toHaveTextContent(/台灣品牌/)
    expect(heading).not.toHaveTextContent(/Made in Taiwan directory/i)
  })

  it('renders search input', async () => {
    render(await HeroSection({ brandCount: 100, categoryCount: 20, recentBrands: { count: 5, period: '7d' } }))
    const searchbox = screen.getByRole('searchbox')
    expect(searchbox).toBeInTheDocument()
    expect(searchbox).toHaveAttribute('placeholder', zhMessages.landing.hero.cta)
  })

  it('routes hero searches to the brand directory', async () => {
    render(await HeroSection({ brandCount: 100, categoryCount: 20, recentBrands: { count: 5, period: '7d' } }))
    expect(screen.getByRole('searchbox')).toHaveAttribute('data-redirect-to', '/brands')
  })

  it('renders trust stats line', async () => {
    render(await HeroSection({ brandCount: 100, categoryCount: 20, recentBrands: { count: 5, period: '7d' } }))
    expect(screen.getByText(/100/)).toBeInTheDocument()
  })

  it('calls trackHeroCategoryClicked when a category chip is clicked', async () => {
    const user = userEvent.setup()
    render(await HeroSection({ brandCount: 100, categoryCount: 20, recentBrands: { count: 5, period: '7d' } }))

    const nav = screen.getByRole('navigation')
    const firstChip = within(nav).getAllByRole('link')[0]
    await user.click(firstChip)

    expect(trackHeroCategoryClicked).toHaveBeenCalledOnce()
    expect(trackHeroCategoryClicked).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('/brands?category='),
    )
  })
})
