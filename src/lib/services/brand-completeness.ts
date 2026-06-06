import type { Brand } from '@/lib/types/brand'

export type CompletenessKey =
  | 'heroImage'
  | 'logo'
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
}

const FIELD_ORDER: {
  key: CompletenessKey
  anchor: string
  isComplete: (b: Brand) => boolean
}[] = [
  { key: 'heroImage', anchor: '#media', isComplete: (b) => !!b.heroImageUrl },
  { key: 'logo', anchor: '#media', isComplete: (b) => !!b.logoUrl },
  { key: 'description', anchor: '#description', isComplete: (b) => !!b.description?.trim() },
  { key: 'purchaseLinks', anchor: '#links', isComplete: (b) => (b.purchaseLinks?.length ?? 0) > 0 },
  { key: 'productPhotos', anchor: '#media', isComplete: (b) => (b.productPhotos?.length ?? 0) > 0 },
  {
    key: 'socialLinks',
    anchor: '#links',
    isComplete: (b) =>
      Object.values(b.socialLinks ?? {}).some((v) => !!(typeof v === 'string' ? v.trim() : v)),
  },
  {
    key: 'brandHighlights',
    anchor: '#brandHighlights',
    isComplete: (b) => !!b.brandHighlights?.trim(),
  },
  { key: 'foundingYear', anchor: '#foundingYear', isComplete: (b) => b.foundingYear != null },
  { key: 'retailLocations', anchor: '#locations', isComplete: (b) => (b.retailLocations?.length ?? 0) > 0 },
]

export function computeBrandCompleteness(brand: Brand): BrandCompleteness {
  const items = FIELD_ORDER.map(({ key, anchor, isComplete }) => ({
    key,
    complete: isComplete(brand),
    anchor,
  }))
  const total = items.length
  const completed = items.filter((item) => item.complete).length
  const fraction = total ? completed / total : 0

  return {
    total,
    completed,
    fraction,
    items,
  }
}
