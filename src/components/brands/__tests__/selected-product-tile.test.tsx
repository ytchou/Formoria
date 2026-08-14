// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { describe, expect, it, vi } from 'vitest'

import type { BrandVisitLinkFields } from '@/lib/brands/link-fallback'
import type { CuratedProduct } from '@/lib/services/curated-products'

vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => <img {...props} />,
}))

import {
  SelectedProductTile,
  type SelectedProductTileLabels,
} from '../selected-product-tile'

const labels: SelectedProductTileLabels = {
  cta: 'Visit product official site',
  brandSiteCta: 'Visit brand official site',
  selectedBadge: 'Selected for this theme',
  brandProvidedBadge: 'Brand-provided information',
  unavailable: 'The official link is currently unavailable',
}

const brand = {
  slug: 'fixture-brand',
  purchaseWebsite: 'https://fixture-brand.example.com',
} as BrandVisitLinkFields & { slug: string }

function product(overrides: Partial<CuratedProduct> = {}): CuratedProduct {
  return {
    id: 'product-id',
    brandId: 'brand-id',
    key: 'reading-lamp',
    nameZh: 'Reading lamp',
    nameEn: 'Reading lamp',
    l1: 'home',
    l2: ['lighting'],
    officialUrl: 'https://fixture-brand.example.com/reading-lamp',
    imageUrl: null,
    imageSourceUrl: null,
    imageUsage: 'none',
    lifecycle: 'published',
    linkState: 'ok',
    linkCheckedAt: null,
    sourceCheckedAt: '2026-08-15T00:00:00Z',
    reviewDueAt: null,
    notesZh: 'A quiet fact.',
    notesEn: 'A quiet fact.',
    highlightPosition: null,
    createdAt: '2026-08-15T00:00:00Z',
    trailSlug: 'small-space-reading-corner',
    sectionKey: 'first',
    position: 1,
    rationaleZh: 'It fits the reading corner.',
    rationaleEn: 'It fits the reading corner.',
    ...overrides,
  }
}

function renderTile(
  mode: 'outbound' | 'internal' | 'trail',
  overrides: Partial<CuratedProduct> = {},
) {
  return render(
    <NextIntlClientProvider locale="zh-TW" messages={{}}>
      <SelectedProductTile
        locale="zh-TW"
        product={product(overrides)}
        labels={labels}
        mode={mode}
        brand={brand}
        brandSlug="fixture-brand"
        brandName="Fixture Brand"
        tracking={{
          brandSlug: 'fixture-brand',
          position: 0,
          surface: 'trail:small-space-reading-corner:first',
        }}
      />
    </NextIntlClientProvider>,
  )
}

describe('SelectedProductTile', () => {
  it('trail mode renders the title link and outbound chip as siblings', () => {
    const { container } = renderTile('trail')

    expect(container.querySelector('a a')).toBeNull()
    const links = container.querySelectorAll('a')
    expect(links).toHaveLength(2)
    expect(links[0]).toHaveTextContent('Reading lamp')
    expect(links[1]).toHaveTextContent('Visit product official site')
  })

  it('trail mode links the title to the brand product anchor', () => {
    renderTile('trail')

    expect(screen.getByRole('link', { name: 'Reading lamp' })).toHaveAttribute(
      'href',
      '/brands/fixture-brand#product-reading-lamp',
    )
  })

  it('trail mode falls back to the brand site when linkState is broken', () => {
    renderTile('trail', { linkState: 'broken' })

    expect(screen.getByRole('link', { name: 'Visit brand official site' })).toHaveAttribute(
      'href',
      'https://fixture-brand.example.com',
    )
  })

  it('outbound mode is unchanged', () => {
    const { container } = renderTile('outbound')

    expect(container.querySelector('li')).toBeInTheDocument()
    expect(container.querySelectorAll('a')).toHaveLength(1)
    expect(screen.getByRole('link', { name: /Visit product official site/ })).toHaveAttribute(
      'href',
      'https://fixture-brand.example.com/reading-lamp',
    )
  })

  it('internal mode is unchanged', () => {
    const { container } = renderTile('internal')

    expect(container.querySelector('li')).toBeInTheDocument()
    expect(container.querySelectorAll('a')).toHaveLength(1)
    expect(screen.getByRole('link', { name: /Reading lamp/ })).toHaveAttribute(
      'href',
      '/brands/fixture-brand#product-reading-lamp',
    )
  })
})
