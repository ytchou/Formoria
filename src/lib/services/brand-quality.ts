import type { Database } from '@/lib/supabase/database.types'
import { createServiceClient } from '@/lib/supabase/server'

type LinkMetric = {
  count: number
  percentage: number
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
}

type BrandQualityRow = Pick<
  Database['public']['Tables']['brands']['Row'],
  | 'hero_image_url'
  | 'social_instagram'
  | 'social_threads'
  | 'social_facebook'
  | 'purchase_website'
  | 'purchase_pinkoi'
  | 'purchase_shopee'
  | 'description'
  | 'product_photos'
  | 'founding_year'
  | 'retail_locations'
  | 'other_urls'
>

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
}

export async function getQualityMetrics(): Promise<QualityMetrics> {
  const supabase = createServiceClient()

  try {
    const { data, error } = await (supabase as unknown as QualityMetricsClient).rpc('get_brand_quality_metrics')
    const row = Array.isArray(data) ? data[0] : data

    if (!error && row) {
      return metricsFromRpcRow(row)
    }
  } catch {
    // Fall back to client-side aggregation below when the RPC is unavailable.
  }

  const { data, error } = await supabase
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
      product_photos,
      founding_year,
      retail_locations,
      other_urls
    `)

  if (error || !data) {
    return EMPTY_QUALITY_METRICS
  }

  return metricsFromRows(data)
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
  }
}

function linkMetric(count: number | null | undefined, total: number): LinkMetric {
  const linkCount = countValue(count)

  return {
    count: linkCount,
    percentage: percentage(linkCount, total),
  }
}

function completenessBucket(row: BrandQualityRow): keyof QualityMetrics['completeness'] {
  const completed = [
    hasText(row.hero_image_url),
    (row.description?.trim().length ?? 0) >= 20,
    hasText(row.purchase_website) || hasText(row.purchase_pinkoi) || hasText(row.purchase_shopee) || jsonArrayLength(row.other_urls) > 0,
    jsonArrayLength(row.product_photos) > 0,
    hasText(row.social_instagram) || hasText(row.social_threads) || hasText(row.social_facebook),
    row.founding_year != null,
    jsonArrayLength(row.retail_locations) > 0,
  ].filter(Boolean).length
  const score = completed / 7

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
