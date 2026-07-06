// @vitest-environment jsdom
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import en from '@/../messages/en.json'
import { DashboardTabNav } from '../dashboard-tab-nav'

type MockLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  children: ReactNode
  href: string
}

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: MockLinkProps) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  usePathname: () => '/dashboard/brands/test-brand',
}))

describe('DashboardTabNav', () => {
  it('renders 2 tab links with correct hrefs', () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <DashboardTabNav brandSlug="test-brand" />
      </NextIntlClientProvider>
    )
    expect(screen.getByRole('link', { name: /Overview/i })).toHaveAttribute(
      'href',
      '/dashboard/brands/test-brand'
    )
    expect(screen.getByRole('link', { name: /Analytics/i })).toHaveAttribute(
      'href',
      '/dashboard/brands/test-brand/analytics'
    )
    expect(screen.queryAllByRole('link')).toHaveLength(2)
  })

  it('marks active tab based on current pathname', () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <DashboardTabNav brandSlug="test-brand" />
      </NextIntlClientProvider>
    )
    const overviewLink = screen.getByRole('link', { name: /Overview/i })
    expect(overviewLink).toHaveAttribute('aria-current', 'page')
  })
})
