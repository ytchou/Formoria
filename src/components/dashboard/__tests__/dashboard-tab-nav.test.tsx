// @vitest-environment jsdom
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  usePathname: vi.fn(() => '/dashboard/brands/test-brand'),
}))

type MockLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  children: ReactNode
  href: string
}

vi.mock('next/navigation', () => ({
  usePathname: mocks.usePathname,
}))

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href, ...props }: MockLinkProps) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

import { DashboardTabNav } from '../dashboard-tab-nav'

describe('DashboardTabNav', () => {
  beforeEach(() => {
    mocks.usePathname.mockReturnValue('/dashboard/brands/test-brand')
  })

  it('renders_all_7_nav_links', () => {
    render(<DashboardTabNav brandSlug="test-brand" />)

    const expectedLinks = [
      ['dashboard.sidebar.overview', '/dashboard/brands/test-brand'],
      ['dashboard.sidebar.info', '/dashboard/brands/test-brand/info'],
      ['dashboard.sidebar.media', '/dashboard/brands/test-brand/media'],
      ['dashboard.sidebar.links', '/dashboard/brands/test-brand/links'],
      ['dashboard.sidebar.verification', '/dashboard/brands/test-brand/verification'],
      ['dashboard.sidebar.reputation', '/dashboard/brands/test-brand/reputation'],
      ['dashboard.sidebar.analytics', '/dashboard/brands/test-brand/analytics'],
    ] as const

    expect(screen.getAllByRole('link')).toHaveLength(7)
    expectedLinks.forEach(([label, href]) => {
      expect(screen.getByRole('link', { name: label })).toHaveAttribute('href', href)
    })
  })

  it('marks_active_tab_with_aria_current', () => {
    mocks.usePathname.mockReturnValue('/dashboard/brands/test-brand/media')
    render(<DashboardTabNav brandSlug="test-brand" />)

    expect(
      screen.getByRole('link', { name: 'dashboard.sidebar.media' }),
    ).toHaveAttribute('aria-current', 'page')
  })

  it('applies_active_visual_class', () => {
    mocks.usePathname.mockReturnValue('/dashboard/brands/test-brand/media')
    render(<DashboardTabNav brandSlug="test-brand" />)

    expect(
      screen.getByRole('link', { name: 'dashboard.sidebar.media' }),
    ).toHaveClass('after:bg-primary', 'after:h-0.5', 'after:opacity-100')
  })
})
