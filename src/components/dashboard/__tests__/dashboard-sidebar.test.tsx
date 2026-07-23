// @vitest-environment jsdom
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import messages from '@/../messages/en.json'

const mocks = vi.hoisted(() => ({
  usePathname: vi.fn(() => '/dashboard/brands/test-brand'),
}))

type MockLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  children: ReactNode
  href: string
}

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href, ...props }: MockLinkProps) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  usePathname: mocks.usePathname,
}))

vi.mock('next/image', () => ({
  default: ({ alt, src }: { alt: string; src: string }) => (
    <span aria-label={alt} data-src={src} role="img" />
  ),
}))

import { DashboardSidebar } from '../dashboard-sidebar'

const defaultProps = {
  brandName: 'Test Brand',
  brandNameEn: 'Test Brand English',
  brandSlug: 'test-brand',
  brandLogoUrl: 'https://example.com/logo.jpg',
  mitStatus: 'verified' as const,
  completenessScore: 72,
  completenessTotal: 12,
  completenessCompleted: 8,
}

function renderSidebar(props = defaultProps) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <DashboardSidebar {...props} />
    </NextIntlClientProvider>,
  )
}

describe('DashboardSidebar', () => {
  beforeEach(() => {
    mocks.usePathname.mockReturnValue('/dashboard/brands/test-brand')
  })

  it('renders all 7 nav items with correct labels', () => {
    renderSidebar()

    const expectedLinks = [
      ['Overview', '/dashboard/brands/test-brand'],
      ['Brand Info', '/dashboard/brands/test-brand/info'],
      ['Media & Photos', '/dashboard/brands/test-brand/media'],
      ['Links & Locations', '/dashboard/brands/test-brand/links'],
      ['MIT Verification', '/dashboard/brands/test-brand/verification'],
      ['Reputation', '/dashboard/brands/test-brand/reputation'],
      ['Analytics', '/dashboard/brands/test-brand/analytics'],
    ] as const

    expectedLinks.forEach(([label, href]) => {
      expect(screen.getByRole('link', { name: label })).toHaveAttribute('href', href)
    })
  })

  it('highlights active nav item based on pathname', () => {
    mocks.usePathname.mockReturnValue('/dashboard/brands/test-brand/media')
    renderSidebar()

    const activeLink = screen.getByRole('link', { name: 'Media & Photos' })
    expect(activeLink).toHaveAttribute('aria-current', 'page')
    expect(activeLink).toHaveClass(
      'bg-sidebar-accent',
      'text-primary',
      'border-l-2',
      'border-primary',
      'font-medium',
    )
  })

  it('renders brand name and MIT status', () => {
    renderSidebar()

    expect(screen.getByText('Test Brand')).toBeInTheDocument()
    expect(screen.getByText('Test Brand English')).toBeInTheDocument()
    expect(screen.getByText('MIT Verified')).toBeInTheDocument()
  })

  it('renders completeness ring with score', () => {
    renderSidebar()

    expect(screen.getByRole('img', { name: '72%' })).toBeInTheDocument()
    expect(screen.getByText('72%')).toBeInTheDocument()
  })
})
