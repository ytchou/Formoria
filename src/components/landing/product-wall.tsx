import { buttonVariants } from '@/components/ui/button'
import { ViewItemListTracker } from '@/components/analytics/view-item-list-tracker'
import { HeroCategoryChips } from '@/components/landing/hero-category-chips'
import {
  SelectedProductTile,
  type SelectedProductTileLabels,
} from '@/components/brands/selected-product-tile'
import { Link } from '@/i18n/navigation'
import type { AppLocale } from '@/i18n/locale-preference'
import { SectionHeader } from '@/components/shared/section-header'
import { categoryLabel, PRODUCT_TYPE_CATEGORIES } from '@/lib/taxonomy/ontology'
import type { TrailEntry } from '@/lib/services/trails'
import type { WallSlot } from '@/lib/curated-products/home-wall'
import {
  WALL_RATIOS,
  type WallRatio,
} from '@/lib/curated-products/wall-ratio'
import { cn } from '@/lib/utils'
import { WallList } from './wall-list'
import { WallTrailTile, type WallTrailTileLabels } from './wall-trail-tile'

/**
 * The masonry is a CSS Grid, never CSS columns: `columns-*` flows column-major,
 * which desynchronises DOM order from visual order and so breaks tab order and
 * the crawler's reading of the editorial sequence.
 *
 * Rows are measured in a unit that is a fixed fraction of ONE COLUMN's width
 * (`--wall-unit`, declared per breakpoint on the list), so a tile's row span is
 * a pure function of its ratio bucket and holds at every column count. A tile
 * of ratio r is `WALL_ROW_UNITS / r` units tall, plus `WALL_GAP_UNITS` for the
 * gutter — the row gap itself is zero, because a real row gap would be added
 * once per spanned row.
 */
export const WALL_ROW_UNITS = 60
export const WALL_GAP_UNITS = 5

/** Rows a product tile occupies, derived from its snapped ratio bucket. */
export function wallRowSpan(ratio: WallRatio): number {
  return Math.round(WALL_ROW_UNITS / WALL_RATIOS[ratio]) + WALL_GAP_UNITS
}

/**
 * How many tiles a phone shows before the reveal control. The one-column
 * measurement put ~30 products at roughly eighteen phone screens, which buries
 * every section under the wall. The cap is CSS-only: nothing is sliced out of
 * the markup, following `masonry-grid.tsx`'s `visibleCount`.
 */
export const WALL_MOBILE_VISIBLE_COUNT = 12

/** Hidden past the cap on phones only, and only while the wall is collapsed. */
const CAPPED_TILE_CLASS =
  'max-sm:group-data-[wall-expanded=false]/wall:hidden'

/**
 * Grid geometry. One column on phones (an editorial scroll, not a wall — a
 * ragged edge needs a neighbour to fall out of phase with), two from `sm`, four
 * from `lg`. `--wall-unit` is one sixtieth of the column width at each step,
 * derived from the 1280px content cap and the page gutters.
 */
const WALL_GRID_CLASS = cn(
  'grid grid-cols-1 gap-6 sm:grid-cols-2 sm:gap-y-0 lg:grid-cols-4',
  // Underscores are Tailwind's spaces; `calc` needs them around every `-`.
  // The container is `max-w-6xl page-gutter`, i.e. border-box 72rem INCLUDING
  // its gutter, so the content measure is `min(100vw, 72rem) - gutter`. Below
  // `lg` the viewport never reaches 72rem, so `min(100vw - gutter, 72rem)`
  // resolves to the same number there and those two declarations stand; at `lg`
  // it overstates the column by 20px at 1440px and more above it.
  'sm:[--wall-unit:calc((min(100vw_-_3rem,72rem)_-_1.5rem)/2/60)]',
  'md:[--wall-unit:calc((min(100vw_-_5rem,72rem)_-_1.5rem)/2/60)]',
  'lg:[--wall-unit:calc((min(100vw,72rem)_-_5rem_-_4.5rem)/4/60)]',
  'sm:[grid-auto-rows:var(--wall-unit)]',
)

/**
 * The gutter the zero row gap owes, in the same column-relative unit and equal
 * to `WALL_GAP_UNITS`. A margin, not padding: padding would paint the trail
 * tile's dark surface into the gutter.
 */
const WALL_TILE_GUTTER_CLASS = 'sm:mb-[calc(var(--wall-unit)*5)]'

/**
 * Row spans as literal classes, because Tailwind scans source text and would
 * never emit a class built at runtime. Every value here is `wallRowSpan()` of
 * its bucket, and the spec asserts that, so the two cannot drift silently.
 */
const WALL_ROW_SPAN_CLASS: Record<WallRatio, string> = {
  '4:3': 'sm:[grid-row:span_50/span_50]',
  '1:1': 'sm:[grid-row:span_65/span_65]',
  '4:5': 'sm:[grid-row:span_80/span_80]',
  '3:4': 'sm:[grid-row:span_85/span_85]',
}

const WALL_CATEGORY_SLUGS = [
  'home',
  'food-drink',
  'crafts',
  'stationery',
  'beauty',
  'fashion',
  'bags-accessories',
] as const

export type ProductWallLabels = {
  heading: string
  note: string
  /** The phone-only reveal control, `landing.selectedProducts.showMore`. */
  showMore: string
  /** Its collapsed-state counterpart — the control is a disclosure, not a
      one-way reveal, so it stays mounted and keeps focus after activation. */
  showLess: string
  continuationHeading: string
  trailLinksLabel: string
  categoryLinksLabel: string
  brandsLink: string
  product: SelectedProductTileLabels
  trail: WallTrailTileLabels
}

/**
 * The homepage wall is deliberately finite: trails that did not earn a slot
 * remain discoverable in the continuation strip, alongside category paths and
 * the known-intent brand directory.
 */
export function ProductWall({
  slots,
  leftoverTrails,
  locale,
  labels,
}: {
  slots: WallSlot[]
  leftoverTrails: TrailEntry[]
  locale: AppLocale
  labels: ProductWallLabels
}) {
  const productCount = slots.filter((slot) => slot.kind === 'product').length
  const categories = WALL_CATEGORY_SLUGS.flatMap((slug) => {
    const category = PRODUCT_TYPE_CATEGORIES.find((item) => item.slug === slug)
    return category
      ? [{ slug: category.slug, label: categoryLabel(category, locale) }]
      : []
  })

  return (
    <section aria-labelledby="landing-selected-products" className="py-6 md:py-8">
      <div className="mx-auto max-w-6xl page-gutter">
        <SectionHeader
          id="landing-selected-products"
          heading={labels.heading}
          note={labels.note}
          className="mb-6"
        />

        <WallList
          ariaLabel={labels.heading}
          className={WALL_GRID_CLASS}
          showMoreLabel={labels.showMore}
          showLessLabel={labels.showLess}
          showControl={slots.length > WALL_MOBILE_VISIBLE_COUNT}
        >
          {slots.map((slot, index) => {
            const cappedClass =
              index >= WALL_MOBILE_VISIBLE_COUNT ? CAPPED_TILE_CLASS : undefined

            return slot.kind === 'trail' ? (
              <WallTrailTile
                key={`trail-${slot.trail.slug}`}
                trail={slot.trail}
                labels={labels.trail}
                format={slot.format}
                position={index}
                className={cn(WALL_TILE_GUTTER_CLASS, cappedClass)}
              />
            ) : (
              <SelectedProductTile
                key={`${slot.product.brandSlug}-${slot.product.key}`}
                locale={locale}
                product={slot.product}
                labels={labels.product}
                mode="wall"
                ratio={slot.ratio}
                wallIndex={index}
                className={cn(
                  WALL_ROW_SPAN_CLASS[slot.ratio],
                  WALL_TILE_GUTTER_CLASS,
                  cappedClass,
                )}
                brand={slot.product.brand}
                brandSlug={slot.product.brandSlug}
                brandName={slot.product.brandName}
                tracking={{
                  brandSlug: slot.product.brandSlug,
                  position: index,
                  surface: 'homepage_wall',
                }}
              />
            )
          })}
        </WallList>

        {/* Products only: a trail tile is not an item of this list, and counting
            it inflated every `view_item_list` for `home_wall`. The list name is
            byte-identical on purpose — it keys the existing series. */}
        <ViewItemListTracker listName="home_wall" itemCount={productCount} />

        <div className="mt-10 space-y-6 border-t border-border pt-6">
          <h3 className="type-section-title-large">{labels.continuationHeading}</h3>

          {leftoverTrails.length > 0 ? (
            <nav aria-label={labels.trailLinksLabel} className="space-y-3">
              <h4 className="type-section-title">{labels.trailLinksLabel}</h4>
              <ul className="flex flex-wrap gap-x-4 type-body">
                {leftoverTrails.map((trail) => (
                  <li key={trail.slug}>
                    {/* min-h-11 keeps the 44px target on a phone, where these
                        wrap into a dense two-line list. */}
                    <Link
                      href={`/discover/${trail.slug}`}
                      prefetch={false}
                      className="inline-flex min-h-11 items-center text-primary underline underline-offset-4 hover:text-primary-dark"
                    >
                      {trail.frontmatter.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}

          <nav aria-label={labels.categoryLinksLabel} className="space-y-3">
            <h4 className="type-section-title">{labels.categoryLinksLabel}</h4>
            <div className="flex flex-wrap gap-2">
              <HeroCategoryChips categories={categories} />
            </div>
          </nav>

          <Link
            href="/brands"
            prefetch={false}
            className={buttonVariants({
              variant: 'secondary',
              shape: 'pill',
              size: 'compact',
              className: 'min-h-11',
            })}
          >
            {labels.brandsLink}
          </Link>
        </div>
      </div>
    </section>
  )
}
