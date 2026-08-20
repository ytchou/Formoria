import type { MetadataRoute } from 'next'
import { localizedEntries } from '@/app/sitemap'
import type { Locale } from './alternates'
import { getBrandIndexability, getBrandPromotion } from './brand-indexability'
import type { BrandSeoEntry } from '@/lib/services/brands'
import { routes } from '@/lib/routes'

const ALL_LOCALES: readonly Locale[] = ['zh-TW', 'en']

function validDate(value: string | undefined): Date | undefined {
  if (!value) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

/**
 * Brand detail entries, gated by two different bars answering two different
 * questions (DEV-1405).
 *
 * `getBrandIndexability` — unchanged low bar — answers "does this locale have a
 * real page?" and drives hreflang. It must keep matching what the brand detail
 * page's own `generateMetadata` emits, or the sitemap and the page contradict
 * each other on which translations exist.
 *
 * `getBrandPromotion` — raised bar — answers "is this page worth pushing at the
 * crawler?" and drives membership only. A brand that fails it keeps its page,
 * stays crawlable, and stays internally linked; it is simply not submitted.
 * Nothing here can produce a `noindex`.
 */
export function buildBrandSitemapEntries(
  brands: ReadonlyArray<BrandSeoEntry>,
): MetadataRoute.Sitemap {
  return brands.flatMap((brand) => {
    const indexability = getBrandIndexability(brand)
    const promotion = getBrandPromotion(brand)
    const alternateLocales = ALL_LOCALES.filter((locale) => indexability[locale])
    const submittedLocales = alternateLocales.filter(
      (locale) => promotion[locale],
    )
    if (submittedLocales.length === 0) return []
    return localizedEntries(
      routes.brand(brand.slug),
      submittedLocales,
      validDate(brand.updatedAt),
      alternateLocales,
    )
  })
}
