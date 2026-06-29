// @vitest-environment jsdom
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import en from '@/../messages/en.json'
import { DashboardEmptyState } from '../dashboard-empty-state'

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
}))

describe('DashboardEmptyState', () => {
  it('renders title and description', () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <DashboardEmptyState />
      </NextIntlClientProvider>
    )
    expect(screen.getByText(en.dashboard.emptyState.title)).toBeInTheDocument()
  })

  it('renders submit and browse CTAs', () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <DashboardEmptyState />
      </NextIntlClientProvider>
    )
    expect(
      screen.getByRole('link', {
        name: new RegExp(en.dashboard.emptyState.submitCta),
      })
    ).toHaveAttribute('href', '/submit')
    expect(
      screen.getByRole('link', {
        name: new RegExp(en.dashboard.emptyState.browseCta),
      })
    ).toHaveAttribute('href', '/brands')
  })
})
