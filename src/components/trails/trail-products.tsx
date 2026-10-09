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
import { routes } from '@/lib/routes'
import { pickNoteKey } from '@/lib/trails/note-key'
import { cn } from '@/lib/utils'
import { MEASURE_PX } from '@/lib/constants/layout'

export type TrailProductsContextValue = {
  trailSlug: string
  locale: AppLocale
  products: readonly TrailCuratedProduct[]
  labels: SelectedProductTileLabels
  /** Pick notes per section key, each keyed `brandSlug/productKey` (D13). */
  notes: Readonly<Record<string, Readonly<Record<string, string>>>>
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
 * The column formula for one section's shelf, chosen by how many products it
 * holds so the last row never strands one tile beside empty cells (DS2-07),
 * and two-up on phones so a section is half as tall as the old one-up stack
 * (DS2-15). Literal class strings, so Tailwind's scanner sees every one.
 *
 * - 1: one tile's width (half a phone, a third from `lg`), never stretched.
 * - 2: two-up at every width.
 * - a multiple of 4: two-up, four-up from `xl`.
 * - a remainder of 1 over 3 (7, 10, ...): three-up from `lg`, four-up from
 *   `xl`, where 3+3+1 would orphan the last tile and 4+3 does not.
 * - everything else (3, 5, 6, ...): two-up, three-up from `lg`.
 *
 * Odd counts above 1 still end a phone row on a single tile; at two columns
 * there is no layout that avoids it.
 */
export function trailGridColumns(count: number): string {
  if (count === 2) return 'grid-cols-2'
  if (count > 0 && count % 4 === 0) return 'grid-cols-2 xl:grid-cols-4'
  if (count > 1 && count % 3 === 1) return 'grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
  return 'grid-cols-2 lg:grid-cols-3'
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
  const sectionNotes = context.notes[section] ?? {}
  // The shelf owns its count-aware columns, so it owns the matching image hint.
  const pageWidth = `min(100vw, ${MEASURE_PX.page}px)`
  const imageSizes = products.length === 2
    ? `calc(${pageWidth} / 2)`
    : products.length % 4 === 0
      ? `(min-width: 1280px) calc(${pageWidth} / 4), calc(100vw / 2)`
      : products.length > 1 && products.length % 3 === 1
        ? `(min-width: 1280px) calc(${pageWidth} / 4), (min-width: 1024px) calc(${pageWidth} / 3), calc(100vw / 2)`
        : undefined

  return (
    <div className="mt-8 border-t border-rule pt-8">
      {/*
        A plain `<ul>`, not `Grid`: the columns are count-aware, so no fixed
        `cols` variant fits. The gap is still the gutter token.
      */}
      <ul className={cn('grid list-none gap-gutter p-0', trailGridColumns(products.length))}>
        {products.map((product, index) => (
          <SelectedProductTile
            key={`${product.key}-${product.position ?? index}`}
            locale={context.locale}
            product={product}
            labels={context.labels}
            mode="trail"
            imageSizes={imageSizes}
            brand={product.brand}
            brandSlug={product.brandSlug}
            brandName={product.brandName}
            note={sectionNotes[pickNoteKey(product.brandSlug, product.key)]}
            tracking={{
              brandSlug: product.brandSlug,
              position: index,
              surface: `trail:${context.trailSlug}:${section}`,
              referrerPage: routes.trail(context.trailSlug),
              brandId: product.brandId,
            }}
          />
        ))}
      </ul>
    </div>
  )
}
