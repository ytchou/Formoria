// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}))
vi.mock('@/i18n/navigation', () => ({
  Link: ({
    children,
    href,
    className,
  }: {
    children: ReactNode
    href: string
    className?: string
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}))
vi.mock('../dashboard-tab-nav', () => ({
  DashboardTabNav: ({ brandSlug }: { brandSlug: string }) => (
    <nav data-testid="tab-nav">Tabs for: {brandSlug}</nav>
  ),
}))
vi.mock('@/components/brands/edit-review-banner', () => ({
  EditReviewBanner: ({ brandSlug }: { brandSlug: string }) => (
    <div data-testid="review-banner">{brandSlug}</div>
  ),
}))

import { BrandDashboardShell } from '../brand-dashboard-shell'

describe('BrandDashboardShell', () => {
  it('renders brand chrome inside the page shell', async () => {
    render(
      await BrandDashboardShell({
        brandName: 'Warmwood Living',
        brandSlug: 'warmwood-living',
        latestReview: null,
        children: <div>dashboard content</div>,
      }),
    )

    expect(
      screen.getByRole('heading', { name: 'Warmwood Living' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'viewButton' })).toHaveAttribute(
      'href',
      '/brands/warmwood-living',
    )
    expect(screen.getByRole('link', { name: 'editButton' })).toHaveAttribute(
      'href',
      '/dashboard/brands/warmwood-living/edit',
    )
    expect(screen.getByTestId('tab-nav')).toHaveTextContent(
      'Tabs for: warmwood-living',
    )
    expect(screen.getByText('dashboard content')).toBeInTheDocument()
  })

  it('renders the review banner inside the page shell when present', async () => {
    render(
      await BrandDashboardShell({
        brandName: 'Warmwood Living',
        brandSlug: 'warmwood-living',
        latestReview: {
          id: 'review-1',
          brandId: 'brand-1',
          createdAt: '2026-01-01',
          status: 'pending',
        },
        children: <div>dashboard content</div>,
      }),
    )

    expect(screen.getByTestId('review-banner')).toHaveTextContent(
      'warmwood-living',
    )
  })
})
