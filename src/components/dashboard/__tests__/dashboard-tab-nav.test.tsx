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
  usePathname: () => '/dashboard',
}))

describe('DashboardTabNav', () => {
  it('renders 4 tab links with correct hrefs', () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <DashboardTabNav brandSlug="test-brand" />
      </NextIntlClientProvider>
    )
    expect(screen.getByRole('link', { name: /Brand Profile/i })).toHaveAttribute(
      'href',
      '/dashboard?brand=test-brand'
    )
    expect(screen.getByRole('link', { name: /Analytics/i })).toHaveAttribute(
      'href',
      '/dashboard/analytics?brand=test-brand'
    )
    expect(screen.getByRole('link', { name: /Brand Health/i })).toHaveAttribute(
      'href',
      '/dashboard/health?brand=test-brand'
    )
    expect(screen.getByRole('link', { name: /MIT Verification/i })).toHaveAttribute(
      'href',
      '/dashboard/verification?brand=test-brand'
    )
  })

  it('marks active tab based on current pathname', () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <DashboardTabNav brandSlug="test-brand" />
      </NextIntlClientProvider>
    )
    const profileLink = screen.getByRole('link', { name: /Brand Profile/i })
    expect(profileLink.className).toMatch(/border-cta|text-foreground/)
  })
})
