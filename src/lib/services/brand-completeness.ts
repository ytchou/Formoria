import type { Brand } from '@/lib/types/brand'

export type CompletenessKey =
  | 'heroImage'
  | 'description'
  | 'purchaseLinks'
  | 'productPhotos'
  | 'socialLinks'
  | 'brandHighlights'
  | 'foundingYear'
  | 'retailLocations'

export type CompletenessItem = {
  key: CompletenessKey
  complete: boolean
  anchor: string
}

export type BrandCompleteness = {
  total: number
  completed: number
  fraction: number
  items: CompletenessItem[]
  tier1Items?: CompletenessItem[]
  tier2Items?: CompletenessItem[]
}

export type ComputedBrandCompleteness = BrandCompleteness & {
  tier1Items: CompletenessItem[]
  tier2Items: CompletenessItem[]
}

export const TIER_1_COUNT = 5

const FIELD_ORDER: {
  key: CompletenessKey
  anchor: string
  isComplete: (b: Brand) => boolean
}[] = [
  { key: 'heroImage', anchor: '#media', isComplete: (b) => !!b.heroImageUrl },
  { key: 'description', anchor: '#description', isComplete: (b) => !!b.description?.trim() },
  {
    key: 'purchaseLinks',
    anchor: '#links',
    isComplete: (b) =>
      [b.purchaseWebsite, b.purchasePinkoi, b.purchaseShopee].some((v) => !!v) || b.otherUrls.length > 0,
  },
  { key: 'productPhotos', anchor: '#media', isComplete: (b) => (b.productPhotos?.length ?? 0) > 0 },
  {
    key: 'socialLinks',
    anchor: '#links',
    isComplete: (b) => [b.socialInstagram, b.socialThreads, b.socialFacebook].some((v) => !!v),
  },
  {
    key: 'brandHighlights',
    anchor: '#brandHighlights',
    isComplete: (b) => !!b.brandHighlights?.trim(),
  },
  { key: 'foundingYear', anchor: '#foundingYear', isComplete: (b) => b.foundingYear != null },
  { key: 'retailLocations', anchor: '#locations', isComplete: (b) => (b.retailLocations?.length ?? 0) > 0 },
]

export function computeBrandCompleteness(brand: Brand): ComputedBrandCompleteness {
  const items = FIELD_ORDER.map(({ key, anchor, isComplete }) => ({
    key,
    complete: isComplete(brand),
    anchor,
  }))
  const total = items.length
  const completed = items.filter((item) => item.complete).length
  const fraction = total ? completed / total : 0
  const tier1Items = items.slice(0, TIER_1_COUNT)
  const tier2Items = items.slice(TIER_1_COUNT)

  return {
    total,
    completed,
    fraction,
    items,
    tier1Items,
    tier2Items,
  }
}
