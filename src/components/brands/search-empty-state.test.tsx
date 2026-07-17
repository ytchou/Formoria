// @vitest-environment jsdom
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { describe, expect, it, vi } from 'vitest'
import type { Brand } from '@/lib/types'
import en from '../../../messages/en.json'
import { SearchEmptyState } from './search-empty-state'

vi.mock('next/link', () => ({
  default: ({ href, children, replace: _replace, scroll: _scroll, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string
    children: ReactNode
    replace?: boolean
    scroll?: boolean
  }) => {
    void _replace
    void _scroll
    return <a href={href} {...props}>{children}</a>
  },
}))

vi.mock('./brand-card', () => ({
  BrandCard: ({ brand, variant }: { brand: Brand; variant: string }) => (
    <div data-testid="recommended-brand" data-variant={variant}>{brand.name}</div>
  ),
}))

const recommendedBrand = {
  id: 'brand-1',
  name: 'Herb Basics',
  slug: 'herb-basics',
} as Brand

function renderEmptyState(overrides: Partial<React.ComponentProps<typeof SearchEmptyState>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <SearchEmptyState
        query="herbs"
        categoryLabel="Jewelry"
        activeFilters={[
          {
            id: 'search',
            label: 'Brand name search',
            value: 'herbs',
            removeHref: '/en/brands?category=jewelry',
            removeLabel: 'Remove Brand name search: herbs',
          },
        ]}
        recoveryActions={[
          { kind: 'removeSearch', href: '/en/brands?category=jewelry' },
          { kind: 'clearFilters', href: '/en/brands?search=herbs' },
          { kind: 'browseAll', href: '/en/brands' },
        ]}
        recommendedBrands={[recommendedBrand]}
        recommendationsHref="/en/brands?category=jewelry"
        {...overrides}
      />
    </NextIntlClientProvider>,
  )
}

describe('SearchEmptyState', () => {
  it('shows the active conditions and contextual recovery actions', () => {
    renderEmptyState()

    expect(screen.getByText('No brands match “herbs” in “Jewelry”.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Remove Brand name search: herbs' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Remove brand keyword/ })).toHaveAttribute(
      'href',
      '/en/brands?category=jewelry',
    )
    expect(screen.getByRole('link', { name: /Clear filters/ })).toHaveAttribute(
      'href',
      '/en/brands?search=herbs',
    )
    expect(screen.getByRole('link', { name: /Browse all brands/ })).toHaveAttribute(
      'href',
      '/en/brands',
    )
  })

  it('renders recommendation cards through the shared BrandCard variant', () => {
    renderEmptyState()

    expect(screen.getByRole('heading', { name: 'You may be looking for' })).toBeInTheDocument()
    expect(screen.getByTestId('recommended-brand')).toHaveAttribute(
      'data-variant',
      'recommendation',
    )
    expect(screen.getByRole('link', { name: 'View all' })).toHaveAttribute(
      'href',
      '/en/brands?category=jewelry',
    )
  })

  it('hides the recommendation section when no fallback brands exist', () => {
    renderEmptyState({ recommendedBrands: [] })

    expect(screen.queryByRole('heading', { name: 'You may be looking for' })).toBeNull()
  })
})
