import { buttonVariants } from '@/components/ui/button'
import { ViewItemListTracker } from '@/components/analytics/view-item-list-tracker'
import { HeroCategoryChips } from '@/components/landing/hero-category-chips'
import {
  SelectedProductTile,
  type SelectedProductTileLabels,
} from '@/components/brands/selected-product-tile'
import { Link } from '@/i18n/navigation'
import type { AppLocale } from '@/i18n/locale-preference'
import { categoryLabel, PRODUCT_TYPE_CATEGORIES } from '@/lib/taxonomy/ontology'
import type { TrailEntry } from '@/lib/services/trails'
import type { WallSlot } from '@/lib/curated-products/home-wall'
import { WallTrailTile, type WallTrailTileLabels } from './wall-trail-tile'

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
  const categories = WALL_CATEGORY_SLUGS.flatMap((slug) => {
    const category = PRODUCT_TYPE_CATEGORIES.find((item) => item.slug === slug)
    return category
      ? [{ slug: category.slug, label: categoryLabel(category, locale) }]
      : []
  })

  return (
    <section aria-labelledby="landing-selected-products" className="py-6 md:py-8">
      <div className="mx-auto max-w-6xl page-gutter">
        <div className="mb-6 space-y-2">
          <h2 id="landing-selected-products" className="type-page-title-large">
            {labels.heading}
          </h2>
          <p className="type-card-description">{labels.note}</p>
        </div>

        {/* Symmetric gutters preserve the 4:3 ratio when a tile spans two tracks. */}
        <ul className="grid list-none grid-cols-2 gap-6 p-0 md:grid-cols-3 lg:grid-cols-4">
          {slots.map((slot, index) =>
            slot.kind === 'trail' ? (
              <WallTrailTile
                key={`trail-${slot.trail.slug}`}
                trail={slot.trail}
                labels={labels.trail}
                position={index}
              />
            ) : (
              <SelectedProductTile
                key={`${slot.product.brandSlug}-${slot.product.key}`}
                locale={locale}
                product={slot.product}
                labels={labels.product}
                mode="wall"
                span={slot.span}
                brand={slot.product.brand}
                brandSlug={slot.product.brandSlug}
                brandName={slot.product.brandName}
                tracking={{
                  brandSlug: slot.product.brandSlug,
                  position: index,
                  surface: 'homepage_wall',
                }}
              />
            ),
          )}
        </ul>

        <ViewItemListTracker listName="home_wall" itemCount={slots.length} />

        <div className="mt-10 space-y-6 border-t border-border pt-6">
          <h3 className="type-section-title-large">{labels.continuationHeading}</h3>

          {leftoverTrails.length > 0 ? (
            <nav aria-label={labels.trailLinksLabel} className="space-y-3">
              <h4 className="type-section-title">{labels.trailLinksLabel}</h4>
              <ul className="flex flex-wrap gap-x-4 gap-y-2 type-body">
                {leftoverTrails.map((trail) => (
                  <li key={trail.slug}>
                    <Link
                      href={`/discover/${trail.slug}`}
                      prefetch={false}
                      className="text-primary underline underline-offset-4 hover:text-primary-dark"
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
            className={buttonVariants({ variant: 'secondary', shape: 'pill', size: 'chip' })}
          >
            {labels.brandsLink}
          </Link>
        </div>
      </div>
    </section>
  )
}
