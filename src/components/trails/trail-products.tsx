'use client'

import { createContext, useContext, type ReactNode } from 'react'

import type { AppLocale } from '@/i18n/locale-preference'
import type {
  TrailCuratedProduct,
} from '@/lib/services/curated-products'
import {
  SelectedProductTile,
  type SelectedProductTileLabels,
} from '@/components/brands/selected-product-tile'
import { Grid } from '@/components/ui/grid'
import { routes } from '@/lib/routes'

export type TrailProductsContextValue = {
  trailSlug: string
  locale: AppLocale
  products: readonly TrailCuratedProduct[]
  labels: SelectedProductTileLabels
}

const TrailProductsContext = createContext<TrailProductsContextValue | null>(null)

export function TrailProductsProvider({
  value,
  children,
}: {
  value: TrailProductsContextValue
  children: ReactNode
}) {
  return <TrailProductsContext.Provider value={value}>{children}</TrailProductsContext.Provider>
}

/**
 * Renders the DB placements for one authored section. MDX expression props are
 * discarded by the renderer, so this component intentionally accepts only the
 * literal section key; products and labels arrive through the route context.
 *
 * THE HAIRLINE IS PART OF THE SECTION HEADER, not decoration on the grid. It
 * closes the editorial block — ordinal, title, intro — and opens the objects,
 * which is the whole shape of the style-page archetype: curation is stated
 * once, up front, and never wrapped around each individual product.
 */
export function TrailProducts({ section }: { section: string }) {
  const context = useContext(TrailProductsContext)
  if (!context) return null

  const products = context.products.filter((product) => product.sectionKey === section)
  if (products.length === 0) return null

  return (
    <div className="mt-8 border-t border-rule pt-8">
      <Grid as="ul" cols="thirds" className="list-none p-0">
        {products.map((product, index) => (
          <SelectedProductTile
            key={`${product.key}-${product.position ?? index}`}
            locale={context.locale}
            product={product}
            labels={context.labels}
            mode="trail"
            brand={product.brand}
            brandSlug={product.brandSlug}
            brandName={product.brandName}
            tracking={{
              brandSlug: product.brandSlug,
              position: index,
              surface: `trail:${context.trailSlug}:${section}`,
              referrerPage: routes.trail(context.trailSlug),
              brandId: product.brandId,
            }}
          />
        ))}
      </Grid>
    </div>
  )
}
