import type { AnalyticsResult } from './brand-analytics'
import { computeBrandCompleteness } from './brand-completeness'
import type { Database } from '@/lib/supabase/database.types'
import type { Brand as AppBrand } from '@/lib/types/brand'

declare module '@/lib/supabase/database.types' {
  export interface Brand extends AppBrand {
    [key: string]: unknown
    created_at?: string | null
    hero_image_url?: string | null
    product_photos?: unknown
    purchase_links?: unknown
    retail_locations?: unknown
    social_links?: unknown
  }
}

type BrandRow = Database['public']['Tables']['brands']['Row']
type Brand = BrandRow | AppBrand

export type DimensionKey =
  | 'profileCompleteness'
  | 'engagementHealth'
  | 'brandStory'
  | 'photoQuality'
  | 'socialPresence'
  | 'purchaseAccessibility'
  | 'clickThroughRate'

export type DimensionScore = {
  key: DimensionKey
  score: number
  coldStart: boolean
  weight: number
}

export type ActionNudge = {
  key: DimensionKey
  anchor: string
  icon: string
  labelKey: DimensionKey
  dimension: string
  points: number
}

type HealthTier = 'gettingStarted' | 'growing' | 'thriving' | 'exemplary'

export type BrandHealthScore = {
  overall: number
  tier: HealthTier
  dimensions: DimensionScore[]
  topActions: ActionNudge[]
}

const DAY_MS = 24 * 60 * 60 * 1000
const COLD_START_MS = 7 * DAY_MS

const WEIGHTS: Record<DimensionKey, number> = {
  profileCompleteness: 0.25,
  engagementHealth: 0.15,
  brandStory: 0.15,
  photoQuality: 0.15,
  socialPresence: 0.1,
  purchaseAccessibility: 0.1,
  clickThroughRate: 0.1,
}

const ANCHORS: Record<DimensionKey, string> = {
  profileCompleteness: '#profile',
  engagementHealth: '#analytics',
  brandStory: '#description',
  photoQuality: '#product-photos',
  socialPresence: '#social-links',
  purchaseAccessibility: '#purchase-links',
  clickThroughRate: '#analytics',
}

const ICONS: Record<DimensionKey, string> = {
  profileCompleteness: 'circle-user',
  engagementHealth: 'trending-up',
  brandStory: 'book-open',
  photoQuality: 'camera',
  socialPresence: 'share-2',
  purchaseAccessibility: 'shopping-bag',
  clickThroughRate: 'mouse-pointer-click',
}

function getField<T>(brand: Brand, camelKey: string, snakeKey: string): T | undefined {
  const source = brand as Record<string, unknown>
  return (source[camelKey] ?? source[snakeKey]) as T | undefined
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function getDescription(brand: Brand): string {
  return getField<string | null>(brand, 'description', 'description')?.trim() ?? ''
}

function getProductPhotos(brand: Brand): unknown[] {
  return toArray(getField<unknown>(brand, 'productPhotos', 'product_photos'))
}

function getPurchaseLinks(brand: Brand): unknown[] {
  // New flat schema: check flat fields first
  const source = brand as Record<string, unknown>
  const flatUrls = [source.purchaseWebsite, source.purchasePinkoi, source.purchaseShopee].filter(Boolean)
  if (flatUrls.length > 0) return flatUrls
  // Legacy JSONB schema fallback
  return toArray(getField<unknown>(brand, 'purchaseLinks', 'purchase_links'))
}

function getSocialLinks(brand: Brand): Record<string, unknown> {
  // New flat schema: check flat fields first
  const source = brand as Record<string, unknown>
  if (source.socialInstagram !== undefined || source.socialThreads !== undefined || source.socialFacebook !== undefined) {
    const result: Record<string, unknown> = {}
    if (source.socialInstagram) result.instagram = source.socialInstagram
    if (source.socialThreads) result.threads = source.socialThreads
    if (source.socialFacebook) result.facebook = source.socialFacebook
    return result
  }
  // Legacy JSONB schema fallback
  const socialLinks = getField<unknown>(brand, 'socialLinks', 'social_links')
  return socialLinks && !Array.isArray(socialLinks) && typeof socialLinks === 'object'
    ? (socialLinks as Record<string, unknown>)
    : {}
}

function scoreEngagement(analytics: AnalyticsResult): number {
  if (analytics.viewTrend === 'up') {
    return 100
  }

  if (analytics.viewTrend === 'down') {
    return 20
  }

  return 60
}

function scoreBrandStory(brand: Brand): number {
  const descriptionLength = getDescription(brand).length
  let descriptionScore = 0

  if (descriptionLength >= 200) {
    descriptionScore = 66
  } else if (descriptionLength >= 100) {
    descriptionScore = 33
  }

  return Math.min(100, descriptionScore)
}

function scorePhotos(brand: Brand): number {
  const photoCount = getProductPhotos(brand).length

  if (photoCount >= 3) {
    return 100
  }

  if (photoCount === 2) {
    return 66
  }

  return photoCount === 1 ? 33 : 0
}

function scoreSocialPresence(brand: Brand): number {
  const filledLinkCount = Object.values(getSocialLinks(brand)).filter((value) => {
    return typeof value === 'string' ? value.trim() : Boolean(value)
  }).length

  if (filledLinkCount >= 2) {
    return 100
  }

  return filledLinkCount === 1 ? 50 : 0
}

function scoreClickThroughRate(analytics: AnalyticsResult): number {
  if (analytics.totalViews === 0) {
    return 0
  }

  const ctr = (analytics.totalClicks / analytics.totalViews) * 100
  return Math.min(100, Math.round((ctr / 3) * 100))
}

function getTier(overall: number): HealthTier {
  if (overall >= 90) {
    return 'exemplary'
  }

  if (overall >= 70) {
    return 'thriving'
  }

  if (overall >= 40) {
    return 'growing'
  }

  return 'gettingStarted'
}

function buildTopActions(dimensions: DimensionScore[]): ActionNudge[] {
  return dimensions
    .filter((dimension) => dimension.score < 100 && !dimension.coldStart)
    .map((dimension) => ({
      key: dimension.key,
      anchor: ANCHORS[dimension.key],
      icon: ICONS[dimension.key],
      labelKey: dimension.key,
      dimension: dimension.key,
      points: Math.round((100 - dimension.score) * dimension.weight * 100),
    }))
    .sort((left, right) => right.points - left.points)
    .slice(0, 3)
}

export function computeBrandHealth(
  brand: Brand,
  analytics: AnalyticsResult | null,
  brandCreatedAt: Date
): BrandHealthScore {
  const isColdStart = Date.now() - brandCreatedAt.getTime() < COLD_START_MS || analytics === null

  const dimensions: DimensionScore[] = [
    {
      key: 'profileCompleteness',
      score: Math.round(computeBrandCompleteness(brand as AppBrand).fraction * 100),
      coldStart: false,
      weight: WEIGHTS.profileCompleteness,
    },
    {
      key: 'engagementHealth',
      score: isColdStart || !analytics ? 0 : scoreEngagement(analytics),
      coldStart: isColdStart,
      weight: WEIGHTS.engagementHealth,
    },
    {
      key: 'brandStory',
      score: scoreBrandStory(brand),
      coldStart: false,
      weight: WEIGHTS.brandStory,
    },
    {
      key: 'photoQuality',
      score: scorePhotos(brand),
      coldStart: false,
      weight: WEIGHTS.photoQuality,
    },
    {
      key: 'socialPresence',
      score: scoreSocialPresence(brand),
      coldStart: false,
      weight: WEIGHTS.socialPresence,
    },
    {
      key: 'purchaseAccessibility',
      score: getPurchaseLinks(brand).length > 0 ? 100 : 0,
      coldStart: false,
      weight: WEIGHTS.purchaseAccessibility,
    },
    {
      key: 'clickThroughRate',
      score: isColdStart || !analytics ? 0 : scoreClickThroughRate(analytics),
      coldStart: isColdStart,
      weight: WEIGHTS.clickThroughRate,
    },
  ]

  const activeDimensions = dimensions.filter((dimension) => !dimension.coldStart)
  const activeWeight = activeDimensions.reduce((sum, dimension) => sum + dimension.weight, 0)
  const weightedScore = activeDimensions.reduce(
    (sum, dimension) => sum + dimension.score * dimension.weight,
    0
  )
  const overall = activeWeight === 0 ? 0 : Math.round(weightedScore / activeWeight)

  return {
    overall,
    tier: getTier(overall),
    dimensions,
    topActions: buildTopActions(dimensions),
  }
}
