// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('next-intl/server', () => ({ getTranslations: vi.fn(async () => (key: string) => key), setRequestLocale: vi.fn() }))
vi.mock('@/i18n/navigation', () => ({ Link: ({ href, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a> }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn().mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } }, error: null }) } }) }))
vi.mock('@/lib/services/saved-brands', () => ({ getUserSavedBrands: vi.fn() }))

import { getUserSavedBrands } from '@/lib/services/saved-brands'
import FavoritesPage from '../page'

describe('FavoritesPage', () => {
  it('renders saved brand names', async () => {
    vi.mocked(getUserSavedBrands).mockResolvedValue([
      { brandId: 'b1', brandName: 'Saved One', brandSlug: 'saved-one', heroImageUrl: null, savedAt: '2026-01-01' },
    ])
    render(await FavoritesPage({ params: Promise.resolve({ locale: 'en' }) }))
    expect(screen.getByText('Saved One')).toBeInTheDocument()
  })

  it('renders empty state when no saved brands', async () => {
    vi.mocked(getUserSavedBrands).mockResolvedValue([])
    render(await FavoritesPage({ params: Promise.resolve({ locale: 'en' }) }))
    expect(screen.getByText('emptyTitle')).toBeInTheDocument()
  })
})
