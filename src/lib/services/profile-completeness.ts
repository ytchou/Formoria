import type { Brand } from '@/lib/types/brand'

type ProfileComponentKey =
  | 'description'
  | 'productTags'
  | 'priceRange'
  | 'heroImage'
  | 'productPhotos'
  | 'officialWebsite'
  | 'city'
  | 'foundingYear'
  | 'socialPresence'
  | 'additionalSalesChannel'
  | 'retailLocations'
  | 'reputation'

type ProfileComponent = {
  key: ProfileComponentKey
  complete: boolean
  required: boolean
  weight: 1 | 3 | 5
  step: number
}

export type ProfileCompleteness = {
  score: number
  completed: number
  total: number
  components: ProfileComponent[]
  recommendations: ProfileComponent[]
}

type ProfileInput = Pick<
  Brand,
  | 'description'
  | 'productTags'
  | 'priceRange'
  | 'heroImageUrl'
  | 'productPhotos'
  | 'purchaseWebsite'
  | 'city'
  | 'foundingYear'
  | 'socialInstagram'
  | 'socialThreads'
  | 'socialFacebook'
  | 'purchasePinkoi'
  | 'purchaseShopee'
  | 'otherUrls'
  | 'retailLocations'
  | 'reputationSummary'
>

const hasText = (value: string | null | undefined) => Boolean(value?.trim())
const hasUrl = (value: string | null | undefined) => {
  if (!value) return false
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function computeProfileCompleteness(
  brand: ProfileInput,
): ProfileCompleteness {
  const components: ProfileComponent[] = [
    {
      key: 'description',
      complete: hasText(brand.description),
      required: true,
      weight: 5,
      step: 0,
    },
    {
      key: 'productTags',
      complete: brand.productTags.some(hasText),
      required: true,
      weight: 3,
      step: 0,
    },
    {
      key: 'priceRange',
      complete: [1, 2, 3].includes(brand.priceRange ?? 0),
      required: true,
      weight: 3,
      step: 0,
    },
    {
      key: 'heroImage',
      complete: hasText(brand.heroImageUrl),
      required: true,
      weight: 5,
      step: 1,
    },
    {
      key: 'productPhotos',
      complete: brand.productPhotos.some(hasText),
      required: true,
      weight: 5,
      step: 1,
    },
    {
      key: 'officialWebsite',
      complete: hasUrl(brand.purchaseWebsite),
      required: true,
      weight: 5,
      step: 2,
    },
    {
      key: 'city',
      complete: hasText(brand.city),
      required: false,
      weight: 3,
      step: 0,
    },
    {
      key: 'foundingYear',
      complete: brand.foundingYear != null,
      required: false,
      weight: 1,
      step: 0,
    },
    {
      key: 'socialPresence',
      complete: [
        brand.socialInstagram,
        brand.socialThreads,
        brand.socialFacebook,
      ].some(hasText),
      required: false,
      weight: 3,
      step: 2,
    },
    {
      key: 'additionalSalesChannel',
      complete:
        [brand.purchasePinkoi, brand.purchaseShopee].some(hasUrl) ||
        brand.otherUrls.some((link) => hasUrl(link.url)),
      required: false,
      weight: 3,
      step: 2,
    },
    {
      key: 'retailLocations',
      complete: brand.retailLocations.length > 0,
      required: false,
      weight: 3,
      step: 3,
    },
    {
      key: 'reputation',
      complete:
        hasText(brand.reputationSummary?.text) &&
        Boolean(
          brand.reputationSummary?.sources.some((source) => hasUrl(source.url)),
        ),
      required: false,
      weight: 5,
      step: 4,
    },
  ]

  const completedWeight = components.reduce(
    (sum, component) => sum + (component.complete ? component.weight : 0),
    0,
  )
  const recommendations = components
    .filter((component) => !component.complete)
    .toSorted(
      (left, right) =>
        Number(right.required) - Number(left.required) ||
        right.weight - left.weight ||
        left.step - right.step,
    )

  const totalWeight = components.reduce((sum, c) => sum + c.weight, 0)

  return {
    score: Math.round((completedWeight / totalWeight) * 100),
    completed: components.filter((component) => component.complete).length,
    total: components.length,
    components,
    recommendations,
  }
}
