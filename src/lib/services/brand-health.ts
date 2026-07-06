import type { AnalyticsResult } from './brand-analytics'
import { computeBrandCompleteness } from './brand-completeness'
import type { Brand } from '@/lib/types/brand'

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

export type HealthTier = 'gettingStarted' | 'growing' | 'thriving' | 'exemplary'

export type BrandHealthScore = {
  overall: number
  tier: HealthTier
  dimensions: DimensionScore[]
  topActions: ActionNudge[]
}

const DAY_MS = 86_400_000
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

function scoreEngagement(analytics: AnalyticsResult): number {
  if (analytics.viewTrend === 'up') return 100
  if (analytics.viewTrend === 'down') return 20
  return 60
}

function scoreBrandStory(brand: Brand): number {
  const descriptionLength = (brand.description ?? '').trim().length
  if (descriptionLength >= 200) return 66
  if (descriptionLength >= 100) return 33
  return 0
}

function scorePhotos(brand: Brand): number {
  const photoCount = brand.productPhotos.length
  if (photoCount >= 3) return 100
  if (photoCount === 2) return 66
  return photoCount === 1 ? 33 : 0
}

function scoreSocialPresence(brand: Brand): number {
  const filledCount = [brand.socialInstagram, brand.socialThreads, brand.socialFacebook]
    .filter((v) => v?.trim())
    .length
  if (filledCount >= 2) return 100
  return filledCount === 1 ? 50 : 0
}

function scorePurchaseAccessibility(brand: Brand): number {
  const hasAny = [brand.purchaseWebsite, brand.purchasePinkoi, brand.purchaseShopee]
    .some((v) => v?.trim())
  return hasAny ? 100 : 0
}

function scoreClickThroughRate(analytics: AnalyticsResult): number {
  if (analytics.totalViews === 0) return 0
  const ctr = (analytics.totalClicks / analytics.totalViews) * 100
  return Math.min(100, Math.round((ctr / 3) * 100))
}

function getTier(overall: number): HealthTier {
  if (overall >= 90) return 'exemplary'
  if (overall >= 70) return 'thriving'
  if (overall >= 40) return 'growing'
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
      score: Math.round(computeBrandCompleteness(brand).fraction * 100),
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
      score: scorePurchaseAccessibility(brand),
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
