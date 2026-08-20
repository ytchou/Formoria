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
    revalidatePath(routes.microsite(slug))
  }

  // These shared pages read brand data and must be invalidated once per batch.
  revalidateLocalizedPath('/')
  revalidateLocalizedPath(routes.about())
  revalidateLocalizedPath(routes.events())
  revalidatePath('/sitemap.xml')
  revalidatePath('/[locale]/events/[slug]', 'page')
  revalidatePath('/[locale]/stories/[slug]', 'page')
}

/**
 * Revalidates event detail pages and the shared event surfaces. An empty list
 * still means the event collection changed, so the hub and sitemap are kept
 * fresh even when no detail slug is known.
 */
export function revalidatePublicEvents(slugs: readonly string[]): void {
  for (const slug of uniqueSlugs(slugs)) {
    revalidateLocalizedPath(routes.event(slug))
  }

  revalidateLocalizedPath(routes.events())
  revalidatePath('/sitemap.xml')
}

export function revalidatePublicStockists(city?: CitySlug | null): void {
  revalidateTag(PUBLIC_BRAND_DATA_TAG, 'max')
  revalidateLocalizedPath(routes.whereToBuy())
  if (city) {
    revalidateLocalizedPath(routes.whereToBuyCity(citySlugToPath(city)))
  }
}
