// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

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
vi.mock('next-intl/server', () => ({
  setRequestLocale: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: {
      getUser: vi
        .fn()
        .mockResolvedValue({
          data: { user: { id: 'user-1', email: 'test@example.com' } },
          error: null,
        }),
    },
  }),
}))
vi.mock('@/lib/services/resolve-dashboard-brand', () => ({
  resolveDashboardBrand: vi.fn(),
}))
vi.mock('@/components/dashboard/dashboard-empty-state', () => ({
  DashboardEmptyState: () => <div data-testid="empty-state" />,
}))

import { resolveDashboardBrand } from '@/lib/services/resolve-dashboard-brand'
import DashboardLayout from '../layout'

function dashboardContext(name: string, slug: string) {
  const brand = {
    brandId: '1',
    brandName: name,
    brandSlug: slug,
    heroImageUrl: null,
    claimedAt: '2026-01-01',
  }

  return {
    brand,
    allBrands: [brand],
    isImpersonating: false,
  }
}

describe('DashboardLayout', () => {
  it('renders child content without brand chrome when the user has a brand', async () => {
    vi.mocked(resolveDashboardBrand).mockResolvedValue(
      dashboardContext('Brand A', 'brand-a'),
    )
    render(
      await DashboardLayout({
        children: <div>child content</div>,
        params: Promise.resolve({ locale: 'en' }),
        searchParams: Promise.resolve({ brand: 'brand-a' }),
      }),
    )
    expect(screen.getByText('child content')).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Brand A' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'viewButton' }),
    ).not.toBeInTheDocument()
  })

  it('renders empty state when user has no brands', async () => {
    vi.mocked(resolveDashboardBrand).mockResolvedValue(null)
    render(
      await DashboardLayout({
        children: <div>child</div>,
        params: Promise.resolve({ locale: 'en' }),
        searchParams: Promise.resolve({}),
      }),
    )
    expect(screen.getByTestId('empty-state')).toBeInTheDocument()
  })

  it('checks the first owned brand when legacy data contains multiple brands', async () => {
    vi.mocked(resolveDashboardBrand).mockResolvedValue(
      dashboardContext('Brand A', 'brand-a'),
    )
    render(
      await DashboardLayout({
        children: <div>child</div>,
        params: Promise.resolve({ locale: 'en' }),
        searchParams: Promise.resolve({}),
      }),
    )
    expect(screen.getByText('child')).toBeInTheDocument()
    expect(resolveDashboardBrand).toHaveBeenCalledWith(
      'user-1',
      'test@example.com',
      undefined,
    )
    expect(screen.queryByText('Brand B')).not.toBeInTheDocument()
  })
})
