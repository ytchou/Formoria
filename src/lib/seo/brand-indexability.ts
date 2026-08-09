import { languagePurity } from '@/lib/services/eval/scorers'

const ENGLISH_PURITY_THRESHOLD = 0.95

export type BrandIndexabilityInput = {
  description: string | null | undefined
  descriptionEn: string | null | undefined
  blurbEn: string | null | undefined
}

export type BrandIndexability = {
  'zh-TW': boolean
  en: boolean
}

function hasText(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isEnglish(value: string | null | undefined): value is string {
  return hasText(value) && languagePurity(value, 'en') >= ENGLISH_PURITY_THRESHOLD
}

/**
 * The floor: may this page be indexed at all in this locale?
 *
 * DEV-1405 deliberately left this bar where it is. Its only consumer is the
 * `robots` meta (and hreflang alternates) on the brand detail page, so raising
 * it would ship `noindex` to hundreds of live brands — guaranteeing they cannot
 * rank, on the strength of a threshold nobody has validated yet, and slow to
 * reverse. The raised bar lives in `getBrandPromotion` below and drives only
 * sitemap membership and internal-link ordering, both of which are reversible
 * within a revalidate window.
 *
 * If you are here to raise this threshold, raise `getBrandPromotion` instead.
 */
export function getBrandIndexability(
  brand: BrandIndexabilityInput,
): BrandIndexability {
  return {
    'zh-TW': hasText(brand.description),
    en: isEnglish(brand.descriptionEn) && isEnglish(brand.blurbEn),
  }
}

export type BrandPromotionInput = {
  /**
   * The `brands.seo_promoted` generated column: description length, purchase
   * channel, and city-or-FAQ depth. Computed in Postgres so the sitemap and the
   * directory ordering read one source of truth — see the DEV-1405 migration.
   */
  seoPromoted: boolean
  descriptionEn: string | null | undefined
  blurbEn: string | null | undefined
}

/**
 * The ceiling: is this page worth actively pushing at the crawler?
 *
 * Gates sitemap membership and promoted-first internal linking. Layers the
 * English-purity check on top of the DB depth bar, because `languagePurity` has
 * no SQL equivalent — a brand can clear the depth bar and still have unusable
 * English copy, in which case only zh-TW is promoted.
 *
 * Failing this is not `noindex`: unpromoted brands stay live, crawlable, and
 * reachable on the site.
 */
export function getBrandPromotion(
  brand: BrandPromotionInput,
): BrandIndexability {
  return {
    'zh-TW': brand.seoPromoted,
    en:
      brand.seoPromoted &&
      isEnglish(brand.descriptionEn) &&
      isEnglish(brand.blurbEn),
  }
}

