// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { describe, expect, it, vi } from 'vitest'

import type { BrandVisitLinkFields } from '@/lib/brands/link-fallback'
import type { TrailCuratedProduct } from '@/lib/services/curated-products'
import type { SelectedProductTileLabels } from '@/components/brands/selected-product-tile'
import { TrailProducts, TrailProductsProvider } from '../trail-products'

vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => <img {...props} />,
}))

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
  purchasePinkoi: null,
  purchaseShopee: null,
  purchaseMyship: null,
  socialInstagram: null,
  socialThreads: null,
  socialFacebook: null,
} as BrandVisitLinkFields & { slug: string }

function makeProduct(key: string, sectionKey: string): TrailCuratedProduct {
  return {
    id: key,
    brandId: 'brand-id',
    key,
    nameZh: key,
    nameEn: key,
    l1: 'home',
    l2: ['lighting'],
    officialUrl: `https://fixture-brand.example.com/${key}`,
    imageUrl: null,
    imageSourceUrl: null,
    imageUsage: 'none',
    lifecycle: 'published',
    linkState: 'ok',
    linkCheckedAt: null,
    sourceCheckedAt: '2026-08-15T00:00:00Z',
    reviewDueAt: null,
    notesZh: null,
    notesEn: null,
    highlightPosition: null,
    createdAt: '2026-08-15T00:00:00Z',
    trailSlug: 'small-space-reading-corner',
    sectionKey,
    position: 1,
    rationaleZh: `Reason for ${key}`,
    rationaleEn: `Reason for ${key}`,
    brandSlug: 'fixture-brand',
    brandName: 'Fixture Brand',
    brand,
  }
}

function renderProducts(section: string) {
  return render(
    <NextIntlClientProvider locale="zh-TW" messages={{}}>
      <TrailProductsProvider
        value={{
          trailSlug: 'small-space-reading-corner',
          locale: 'zh-TW',
          products: [
            makeProduct('first-product', 'first'),
            makeProduct('second-product', 'second'),
            makeProduct('third-product', 'first'),
          ],
          labels,
        }}
      >
        <TrailProducts section={section} />
      </TrailProductsProvider>
    </NextIntlClientProvider>,
  )
}

describe('TrailProducts', () => {
  it('renders one li per selection in the named section', () => {
    const { container } = renderProducts('first')

    expect(container.querySelectorAll('li')).toHaveLength(2)
    expect(screen.getByText('first-product')).toBeInTheDocument()
    expect(screen.getByText('third-product')).toBeInTheDocument()
    expect(screen.queryByText('second-product')).not.toBeInTheDocument()
  })

  it('renders nothing for an unknown section key', () => {
    const { container } = renderProducts('unknown')

    expect(container.querySelector('ul')).toBeNull()
    expect(container.querySelectorAll('li')).toHaveLength(0)
  })
})
