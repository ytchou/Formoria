// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import zhMessages from '../../../messages/zh-TW.json'

vi.mock('next/image', () => ({
  default: ({ alt = '', ...props }: Record<string, unknown>) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={String(alt)} {...props} />
  ),
}))

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode; [key: string]: unknown }) => <a href={href} {...props}>{children}</a>,
}))

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn().mockResolvedValue((key: string) => {
    const messages = zhMessages.landing.hero as Record<string, string>
    return messages[key] ?? key
  }),
}))

import HeroSection from './hero-section'

describe('HeroSection', () => {
  it('renders the main heading', async () => {
    render(await HeroSection({ brandCount: 100, categoryCount: 20 }))
    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading).toBeInTheDocument()
  })

  it('renders CTA link to /brands', async () => {
    render(await HeroSection({ brandCount: 100, categoryCount: 20 }))
    const link = screen.getByRole('link', { name: /探索所有品牌/ })
    expect(link).toHaveAttribute('href', '/brands')
  })
})
