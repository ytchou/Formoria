import { revalidatePath, revalidateTag } from 'next/cache'
import { routing } from '@/i18n/routing'
import { citySlugToPath, type CitySlug } from '@/lib/constants/taiwan-cities'
import { routes } from '@/lib/routes'

export const PUBLIC_BRAND_DATA_TAG = 'public-brand-data'

/**
 * `localePrefix: 'as-needed'` serves the default locale through the exact
 * prefixless route, while English uses its visible `/en` route. Keep this
 * separate from localized shared pages because brand detail has two concrete
 * route files after the default-locale route split.
 */
export function revalidateLocalizedPath(path: string): void {
  for (const locale of routing.locales) {
    revalidatePath(path === '/' ? `/${locale}` : `/${locale}${path}`)
  }
}

/**
 * Cache invalidation for one discovery trail. `/discover/[slug]` lives under the
 * `[locale]` segment, so a bare unprefixed path invalidates nothing.
 *
 * Lives here rather than in the two action files that call it: it was
 * byte-for-byte duplicated between `src/app/admin/actions.ts` and
 * `src/app/admin/curated-products/actions.ts`, and a trail is a public cached
 * surface like every other one this module owns. `revalidatePublicBrands`
 * deliberately does NOT reach `/discover/[slug]`, so a brand- or product-level
 * write needs this as well, not instead.
 */
export function revalidateTrail(trailSlug: string): void {
  revalidateLocalizedPath(routes.trail(trailSlug))
}

function uniqueSlugs(slugs: readonly string[]): string[] {
  return [
    ...new Set(
      slugs
        .map((slug) => slug.trim())
        .filter(Boolean),
    ),
  ]
}

/**
 * Revalidates every cached public surface that reads brand data.
 *
 * Keep this list centralized: when a new cached page reads brand data, add its
 * route family here or a successful brand write can silently leave it stale.
 * `/brands` and taxonomy pages are deliberately absent because the fresh
 * production build shows those routes are dynamic and have no ISR entries.
 */
export function revalidatePublicBrands(slugs: readonly string[]): void {
  const unique = uniqueSlugs(slugs)
  if (unique.length === 0) return

  revalidateTag(PUBLIC_BRAND_DATA_TAG, 'max')

  for (const slug of unique) {
    revalidatePath(routes.brand(slug))
    revalidatePath(`/en${routes.brand(slug)}`)
  }

  // These shared pages read brand data and must be invalidated once per batch.
  revalidateLocalizedPath('/')
  revalidateLocalizedPath(routes.about())
  revalidatePath('/sitemap.xml')
  revalidatePath('/[locale]/stories/[slug]', 'page')
}

export function revalidatePublicStockists(city?: CitySlug | null): void {
  revalidateTag(PUBLIC_BRAND_DATA_TAG, 'max')
  revalidateLocalizedPath(routes.whereToBuy())
  if (city) {
    revalidateLocalizedPath(routes.whereToBuyCity(citySlugToPath(city)))
  }
}
