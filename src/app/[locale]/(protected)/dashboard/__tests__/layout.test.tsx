// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href, className }: { children: ReactNode; href: string; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}))
vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
  setRequestLocale: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1', email: 'test@example.com' } }, error: null }) },
  }),
}))
vi.mock('@/lib/services/brand-owners', () => ({ getUserBrands: vi.fn() }))
vi.mock('@/lib/services/profiles', () => ({ getProfile: vi.fn().mockResolvedValue(null) }))
vi.mock('@/components/dashboard/dashboard-tab-nav', () => ({
  DashboardTabNav: ({ brandSlug }: { brandSlug: string }) => <nav data-testid="tab-nav">Tabs for: {brandSlug}</nav>,
}))
vi.mock('@/components/dashboard/dashboard-empty-state', () => ({
  DashboardEmptyState: () => <div data-testid="empty-state" />,
}))
vi.mock('@/components/dashboard/welcome-banner', () => ({
  WelcomeBanner: () => <div data-testid="welcome-banner" />,
}))
vi.mock('@/components/dashboard/dashboard-content-layout', () => ({
  DashboardContentLayout: ({ children, onboarding }: { children: ReactNode; onboarding: ReactNode }) => (
    <div>{onboarding}{children}</div>
  ),
}))

import { getUserBrands } from '@/lib/services/brand-owners'
import DashboardLayout from '../layout'

describe('DashboardLayout', () => {
  it('renders the single brand name and tabs when the user has a brand', async () => {
    vi.mocked(getUserBrands).mockResolvedValue([
      { brandId: '1', brandName: 'Brand A', brandSlug: 'brand-a', heroImageUrl: null, claimedAt: '2026-01-01' },
    ])
    render(await DashboardLayout({
      children: <div>child content</div>,
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({ brand: 'brand-a' }),
    }))
    expect(screen.getByRole('heading', { name: 'Brand A' })).toBeInTheDocument()
    expect(screen.getByTestId('tab-nav')).toBeInTheDocument()
    expect(screen.getByTestId('welcome-banner')).toBeInTheDocument()
    expect(screen.getByText('child content')).toBeInTheDocument()
  })

  it('renders empty state when user has no brands', async () => {
    vi.mocked(getUserBrands).mockResolvedValue([])
    render(await DashboardLayout({
      children: <div>child</div>,
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({}),
    }))
    expect(screen.getByTestId('empty-state')).toBeInTheDocument()
    expect(screen.queryByTestId('tab-nav')).not.toBeInTheDocument()
  })

  it('renders the first owned brand when legacy data contains multiple brands', async () => {
    vi.mocked(getUserBrands).mockResolvedValue([
      { brandId: '1', brandName: 'Brand A', brandSlug: 'brand-a', heroImageUrl: null, claimedAt: '2026-01-01' },
      { brandId: '2', brandName: 'Brand B', brandSlug: 'brand-b', heroImageUrl: null, claimedAt: '2026-01-02' },
    ])
    render(await DashboardLayout({
      children: <div>child</div>,
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({}),
    }))
    expect(screen.getByRole('heading', { name: 'Brand A' })).toBeInTheDocument()
    expect(screen.queryByText('Brand B')).not.toBeInTheDocument()
  })
})
