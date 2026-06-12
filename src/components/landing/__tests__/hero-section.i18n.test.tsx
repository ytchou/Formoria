// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import enMessages from '../../../../messages/en.json'
import zhMessages from '../../../../messages/zh-TW.json'

const mockGetTranslations = vi.hoisted(() => vi.fn())

vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => <img {...props} />,
}))

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode; [key: string]: unknown }) => <a href={href} {...props}>{children}</a>,
}))

vi.mock('next-intl/server', () => ({
  getTranslations: mockGetTranslations,
}))

import HeroSection from '../hero-section'

describe('HeroSection (English)', () => {
  it('renders the English headline', async () => {
    mockGetTranslations.mockResolvedValue((key: string) => {
      const messages = enMessages.landing.hero as Record<string, string>
      return messages[key] ?? key
    })

    render(await HeroSection({ brandCount: 100, categoryCount: 20 }))

    expect(screen.getByText(enMessages.landing.hero.headline)).toBeInTheDocument()
  })

  it('omits the subheadline when the locale message is empty', async () => {
    mockGetTranslations.mockResolvedValue((key: string) => {
      const messages = zhMessages.landing.hero as Record<string, string>
      return messages[key] ?? key
    })

    render(await HeroSection({ brandCount: 100, categoryCount: 20 }))

    expect(screen.queryByText(enMessages.landing.hero.subheadline)).not.toBeInTheDocument()
  })
})
