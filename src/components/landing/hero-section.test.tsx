// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { NextIntlClientProvider } from 'next-intl'
import zhMessages from '../../../messages/zh-TW.json'

vi.mock('next/image', () => ({
  default: ({ alt = '', ...props }: Record<string, unknown>) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={String(alt)} {...props} />
  ),
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode; [key: string]: unknown }) => <a href={href} {...props}>{children}</a>,
}))

import HeroSection from './hero-section'

function renderWithZhTW(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="zh-TW" messages={zhMessages}>
      {ui}
    </NextIntlClientProvider>
  )
}

describe('HeroSection', () => {
  it('renders the main heading', () => {
    renderWithZhTW(<HeroSection />)
    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading).toBeInTheDocument()
  })

  it('renders CTA link to /brands', () => {
    renderWithZhTW(<HeroSection />)
    const link = screen.getByRole('link', { name: /探索品牌/ })
    expect(link).toHaveAttribute('href', '/brands')
  })
})
