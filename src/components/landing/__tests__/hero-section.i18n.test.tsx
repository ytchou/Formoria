// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { NextIntlClientProvider } from 'next-intl'
import enMessages from '../../../../messages/en.json'
import zhMessages from '../../../../messages/zh-TW.json'

vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => <img {...props} />,
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode; [key: string]: unknown }) => <a href={href} {...props}>{children}</a>,
}))

import HeroSection from '../hero-section'

describe('HeroSection (English)', () => {
  it('renders the English headline', () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <HeroSection />
      </NextIntlClientProvider>
    )

    expect(screen.getByText(enMessages.landing.hero.headline)).toBeInTheDocument()
  })

  it('omits the subheadline when the locale message is empty', () => {
    render(
      <NextIntlClientProvider locale="zh-TW" messages={zhMessages}>
        <HeroSection />
      </NextIntlClientProvider>
    )

    expect(screen.queryByText(enMessages.landing.hero.subheadline)).not.toBeInTheDocument()
  })
})
