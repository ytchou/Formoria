// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import messages from '../../../messages/en.json'

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async (namespace: string) => (key: string) => {
    const parts = `${namespace}.${key}`.split('.')
    let current: unknown = messages

    for (const part of parts) {
      if (typeof current !== 'object' || current === null) return key
      current = (current as Record<string, unknown>)[part]
    }

    return typeof current === 'string' ? current : key
  }),
}))

import AboutHero from './about-hero'

describe('AboutHero', () => {
  it('renders the About thesis, actions, and directory stats', async () => {
    render(
      await AboutHero({
        brandCount: 345,
        categoryCount: 12,
        recentBrands: { count: 24, period: '30d' },
      }),
    )

    expect(screen.getByRole('heading', { level: 1, name: messages.about.hero.title })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: messages.about.hero.cta })).toHaveAttribute('href', '/brands')
    expect(screen.getByRole('link', { name: messages.about.guide.cta })).toHaveAttribute(
      'href',
      '/getting-started',
    )
    const stats = screen.getByText((_, element) => element?.classList.contains('type-metadata') ?? false)
    expect(stats).toHaveTextContent('345 brands · 12 categories · +24 new brands')
  })

  it('uses the landing page hero image treatment', async () => {
    render(
      await AboutHero({
        brandCount: 0,
        categoryCount: 0,
        recentBrands: { count: 0, period: '30d' },
      }),
    )

    const heroImage = screen.getByAltText('')
    expect(heroImage).toHaveAttribute('src', expect.stringContaining('hero-bg.png'))
    expect(heroImage).toHaveClass('object-cover', 'object-right')
    expect(heroImage.closest('section')).toHaveClass('py-12', 'md:py-20')
    expect(heroImage.closest('section')?.querySelector('[aria-hidden="true"]')).toHaveClass(
      'bg-background/70',
      'md:bg-background/45',
    )
  })
})
