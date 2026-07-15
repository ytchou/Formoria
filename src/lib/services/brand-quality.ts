import type { Database } from '@/lib/supabase/database.types'
import { createServiceClient } from '@/lib/supabase/server'
import { languagePurity } from './eval/scorers'

type LinkMetric = {
  count: number
  percentage: number
}

export type EnrichmentQualityMetrics = {
  languagePurityPct: number
  heroClassifiedPct: number
  promoHeroCount: number
  validationFailures: number
  descriptionCoveragePct: number
  descriptionEnCoveragePct: number
}

export type QualityMetrics = {
  totalBrands: number
  heroImage: {
    withCount: number
    withoutCount: number
    percentage: number
  }
  links: {
    socialInstagram: LinkMetric
    socialThreads: LinkMetric
    socialFacebook: LinkMetric
    purchaseWebsite: LinkMetric
    purchasePinkoi: LinkMetric
    purchaseShopee: LinkMetric
  }
  description: {
    withCount: number
    withoutCount: number
    percentage: number
    avgLength: number
  }
  completeness: {
    excellent: number
    good: number
    fair: number
    poor: number
  }
  enrichment: EnrichmentQualityMetrics
}

type EnrichmentQualityInput = {
  brands: readonly {
    description: string | null
    descriptionEn: string | null
  }[]
  images: readonly {
    role: string | null
    tag: string | null
  }[]
  aiRejections: number
}

type BrandQualityRow = {
  hero_image_url: string | null
  social_instagram: string | null
  social_threads: string | null
  social_facebook: string | null
  purchase_website: string | null
  purchase_pinkoi: string | null
  purchase_shopee: string | null
  description: string | null
  founding_year: number | null
  retail_locations: unknown
  other_urls: unknown
}

type QualityMetricsRpcRow = {
  total_brands?: number | null
  hero_image_count?: number | null
  social_instagram_count?: number | null
  social_threads_count?: number | null
  social_facebook_count?: number | null
  purchase_website_count?: number | null
  purchase_pinkoi_count?: number | null
  purchase_shopee_count?: number | null
  description_count?: number | null
  avg_description_length?: number | null
  completeness_excellent?: number | null
  completeness_good?: number | null
  completeness_fair?: number | null
  completeness_poor?: number | null
}

type QualityMetricsClient = ReturnType<typeof createServiceClient> & {
  rpc: (
    fn: string,
    args?: Record<string, unknown>
  ) => Promise<{ data: QualityMetricsRpcRow | QualityMetricsRpcRow[] | null; error: unknown }>
}

type BrandQualityClient = {
  from(table: 'brands'): {
    select: (columns: string) => Promise<{ data: BrandQualityRow[] | null; error: unknown }>
  }
}

type EnrichmentBrandRow = {
  description: string | null
  description_en: string | null
}

type EnrichmentImageRow = {
  sort_order: number | null
  tags: string[] | null
}

type EnrichmentAiResultRow = Pick<
  Database['public']['Tables']['brand_ai_results']['Row'],
  'attempt' | 'raw_response'
>

type EnrichmentEqQuery<T> = {
  eq: (column: string, value: string | number) => EnrichmentEqQuery<T>
  not: (column: string, operator: string, value: unknown) => EnrichmentEqQuery<T>
} & Promise<{ data: T[] | null; error: unknown }>

type EnrichmentQualityClient = {
  from(table: 'brands'): {
    select: (columns: string) => Promise<{ data: EnrichmentBrandRow[] | null; error: unknown }>
  }
  from(table: 'brand_images'): {
    select: (columns: string) => EnrichmentEqQuery<EnrichmentImageRow>
  }
  from(table: 'brand_ai_results'): {
    select: (columns: string) => EnrichmentEqQuery<EnrichmentAiResultRow>
  }
}

const EMPTY_ENRICHMENT_QUALITY_METRICS: EnrichmentQualityMetrics = {
  languagePurityPct: 0,
  heroClassifiedPct: 0,
  promoHeroCount: 0,
  validationFailures: 0,
  descriptionCoveragePct: 0,
  descriptionEnCoveragePct: 0,
}

const EMPTY_QUALITY_METRICS: QualityMetrics = {
  totalBrands: 0,
  heroImage: { withCount: 0, withoutCount: 0, percentage: 0 },
  links: {
    socialInstagram: { count: 0, percentage: 0 },
    socialThreads: { count: 0, percentage: 0 },
    socialFacebook: { count: 0, percentage: 0 },
    purchaseWebsite: { count: 0, percentage: 0 },
    purchasePinkoi: { count: 0, percentage: 0 },
    purchaseShopee: { count: 0, percentage: 0 },
  },
  description: { withCount: 0, withoutCount: 0, percentage: 0, avgLength: 0 },
  completeness: { excellent: 0, good: 0, fair: 0, poor: 0 },
  enrichment: EMPTY_ENRICHMENT_QUALITY_METRICS,
}

const ZH_LANGUAGE_PURITY_THRESHOLD = 0.85
const PROMO_HERO_TAGS = new Set(['promo', 'text_banner', 'irrelevant', 'logo'])

export function computeQualityMetrics(input: EnrichmentQualityInput): EnrichmentQualityMetrics {
  const totalBrands = input.brands.length
  const brandsWithDescription = input.brands.filter((brand) => brand.description != null)
  const brandsWithDescriptionEn = input.brands.filter((brand) => brand.descriptionEn != null)
  const pureZhDescriptions = brandsWithDescription.filter((brand) => {
    return languagePurity(brand.description ?? '', 'zh') >= ZH_LANGUAGE_PURITY_THRESHOLD
  }).length
  const heroImages = input.images.filter((image) => image.role === 'hero')
  const classifiedHeroCount = heroImages.filter((image) => hasText(image.tag)).length
  const promoHeroCount = heroImages.filter((image) => {
    return image.tag != null && PROMO_HERO_TAGS.has(image.tag)
  }).length

  return {
    languagePurityPct: percentage(pureZhDescriptions, totalBrands),
    heroClassifiedPct: percentage(classifiedHeroCount, heroImages.length),
    promoHeroCount,
    validationFailures: input.aiRejections,
    descriptionCoveragePct: percentage(brandsWithDescription.length, totalBrands),
    descriptionEnCoveragePct: percentage(brandsWithDescriptionEn.length, totalBrands),
  }
}

export async function getQualityMetrics(): Promise<QualityMetrics> {
  const supabase = createServiceClient()
  let metrics = EMPTY_QUALITY_METRICS

  try {
    const { data, error } = await (supabase as unknown as QualityMetricsClient).rpc('get_brand_quality_metrics')
    const row = Array.isArray(data) ? data[0] : data

    if (!error && row) {
      metrics = metricsFromRpcRow(row)
    }
  } catch {
    // Fall back to client-side aggregation below when the RPC is unavailable.
  }

  if (metrics === EMPTY_QUALITY_METRICS) {
    const { data, error } = await (supabase as unknown as BrandQualityClient)
      .from('brands')
      .select(`
        hero_image_url,
        social_instagram,
        social_threads,
        social_facebook,
        purchase_website,
        purchase_pinkoi,
        purchase_shopee,
        description,
        founding_year,
        retail_locations,
        other_urls
      `)

    if (!error && data) {
      metrics = metricsFromRows(data)
    }
  }

  return {
    ...metrics,
    enrichment: await getEnrichmentQualityMetrics(supabase),
  }
}

function metricsFromRpcRow(row: QualityMetricsRpcRow): QualityMetrics {
  const totalBrands = countValue(row.total_brands)
  const heroImageCount = countValue(row.hero_image_count)
  const descriptionCount = countValue(row.description_count)

  return {
    totalBrands,
    heroImage: {
      withCount: heroImageCount,
      withoutCount: Math.max(0, totalBrands - heroImageCount),
      percentage: percentage(heroImageCount, totalBrands),
    },
    links: {
      socialInstagram: linkMetric(row.social_instagram_count, totalBrands),
      socialThreads: linkMetric(row.social_threads_count, totalBrands),
      socialFacebook: linkMetric(row.social_facebook_count, totalBrands),
      purchaseWebsite: linkMetric(row.purchase_website_count, totalBrands),
      purchasePinkoi: linkMetric(row.purchase_pinkoi_count, totalBrands),
      purchaseShopee: linkMetric(row.purchase_shopee_count, totalBrands),
    },
    description: {
      withCount: descriptionCount,
      withoutCount: Math.max(0, totalBrands - descriptionCount),
      percentage: percentage(descriptionCount, totalBrands),
      avgLength: Math.round(Number(row.avg_description_length ?? 0)),
    },
    completeness: {
      excellent: countValue(row.completeness_excellent),
      good: countValue(row.completeness_good),
      fair: countValue(row.completeness_fair),
      poor: countValue(row.completeness_poor),
    },
    enrichment: EMPTY_ENRICHMENT_QUALITY_METRICS,
  }
}

function metricsFromRows(rows: BrandQualityRow[]): QualityMetrics {
  const totalBrands = rows.length
  let heroImageCount = 0
  let socialInstagramCount = 0
  let socialThreadsCount = 0
  let socialFacebookCount = 0
  let purchaseWebsiteCount = 0
  let purchasePinkoiCount = 0
  let purchaseShopeeCount = 0
  let descriptionCount = 0
  let descriptionLengthTotal = 0
  const completeness = { excellent: 0, good: 0, fair: 0, poor: 0 }

  for (const row of rows) {
    if (hasText(row.hero_image_url)) heroImageCount += 1
    if (hasText(row.social_instagram)) socialInstagramCount += 1
    if (hasText(row.social_threads)) socialThreadsCount += 1
    if (hasText(row.social_facebook)) socialFacebookCount += 1
    if (hasText(row.purchase_website)) purchaseWebsiteCount += 1
    if (hasText(row.purchase_pinkoi)) purchasePinkoiCount += 1
    if (hasText(row.purchase_shopee)) purchaseShopeeCount += 1

    const descriptionLength = row.description?.trim().length ?? 0
    if (descriptionLength >= 20) {
      descriptionCount += 1
      descriptionLengthTotal += descriptionLength
    }

    completeness[completenessBucket(row)] += 1
  }

  return {
    totalBrands,
    heroImage: {
      withCount: heroImageCount,
      withoutCount: Math.max(0, totalBrands - heroImageCount),
      percentage: percentage(heroImageCount, totalBrands),
    },
    links: {
      socialInstagram: { count: socialInstagramCount, percentage: percentage(socialInstagramCount, totalBrands) },
      socialThreads: { count: socialThreadsCount, percentage: percentage(socialThreadsCount, totalBrands) },
      socialFacebook: { count: socialFacebookCount, percentage: percentage(socialFacebookCount, totalBrands) },
      purchaseWebsite: { count: purchaseWebsiteCount, percentage: percentage(purchaseWebsiteCount, totalBrands) },
      purchasePinkoi: { count: purchasePinkoiCount, percentage: percentage(purchasePinkoiCount, totalBrands) },
      purchaseShopee: { count: purchaseShopeeCount, percentage: percentage(purchaseShopeeCount, totalBrands) },
    },
    description: {
      withCount: descriptionCount,
      withoutCount: Math.max(0, totalBrands - descriptionCount),
      percentage: percentage(descriptionCount, totalBrands),
      avgLength: descriptionCount > 0 ? Math.round(descriptionLengthTotal / descriptionCount) : 0,
    },
    completeness,
    enrichment: EMPTY_ENRICHMENT_QUALITY_METRICS,
  }
}

async function getEnrichmentQualityMetrics(
  supabase: ReturnType<typeof createServiceClient>
): Promise<EnrichmentQualityMetrics> {
  const client = supabase as unknown as EnrichmentQualityClient
  const [brandsResult, imagesResult, aiResultsResult] = await Promise.all([
    client.from('brands').select('description, description_en'),
    client
      .from('brand_images')
      .select('sort_order, tags')
      .eq('status', 'active')
      .eq('sort_order', 0),
    client
      .from('brand_ai_results')
      .select('attempt, raw_response')
      .eq('phase', 'description')
      .not('raw_response', 'is', null),
  ])

  return computeQualityMetrics({
    brands: brandsResult.error || !brandsResult.data
      ? []
      : brandsResult.data.map((brand) => ({
          description: brand.description,
          descriptionEn: brand.description_en,
        })),
    images: imagesResult.error || !imagesResult.data
      ? []
      : imagesResult.data.map((image) => ({
          role: image.sort_order === 0 ? 'hero' : 'other',
          tag: firstImageTag(image.tags),
        })),
    aiRejections: aiResultsResult.error || !aiResultsResult.data
      ? 0
      : countDescriptionValidationRetries(aiResultsResult.data),
  })
}

function linkMetric(count: number | null | undefined, total: number): LinkMetric {
  const linkCount = countValue(count)

  return {
    count: linkCount,
    percentage: percentage(linkCount, total),
  }
}

function firstImageTag(tags: string[] | null): string | null {
  return tags?.find(hasText) ?? null
}

export function countDescriptionValidationRetries(
  rows: readonly Pick<EnrichmentAiResultRow, 'attempt' | 'raw_response'>[],
): number {
  return rows.filter((row) => row.raw_response != null && (row.attempt ?? 0) > 1).length
}

function completenessBucket(row: BrandQualityRow): keyof QualityMetrics['completeness'] {
  const completed = [
    hasText(row.hero_image_url),
    (row.description?.trim().length ?? 0) >= 20,
    hasText(row.purchase_website) || hasText(row.purchase_pinkoi) || hasText(row.purchase_shopee) || jsonArrayLength(row.other_urls) > 0,
    hasText(row.social_instagram) || hasText(row.social_threads) || hasText(row.social_facebook),
    row.founding_year != null,
    jsonArrayLength(row.retail_locations) > 0,
  ].filter(Boolean).length
  const score = completed / 6

  if (score >= 0.8) return 'excellent'
  if (score >= 0.6) return 'good'
  if (score >= 0.4) return 'fair'

  return 'poor'
}

function hasText(value: string | null | undefined): value is string {
  return value != null && value.trim() !== ''
}

function jsonArrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0
}

function countValue(value: number | null | undefined): number {
  return Number(value ?? 0)
}

function percentage(count: number, total: number): number {
  return total > 0 ? Math.round((count / total) * 100) : 0
}
