import type { Brand, BrandFlatLinkColumns } from '@/lib/types'
import type { ScrapedBrandData } from '@/lib/types/scraper'

const MAX_PRODUCT_PHOTOS = 5

export const LINK_FIELDS = [
  'socialInstagram',
  'socialThreads',
  'socialFacebook',
  'purchaseWebsite',
  'purchasePinkoi',
  'purchaseShopee',
] as const

export type LinkField = (typeof LINK_FIELDS)[number]
export type LinkColumn = Exclude<keyof BrandFlatLinkColumns, 'other_urls'>

const LINK_FIELD_TO_COLUMN = {
  socialInstagram: 'social_instagram',
  socialThreads: 'social_threads',
  socialFacebook: 'social_facebook',
  purchaseWebsite: 'purchase_website',
  purchasePinkoi: 'purchase_pinkoi',
  purchaseShopee: 'purchase_shopee',
} as const satisfies Record<LinkField, LinkColumn>

type ImageEnrichBrand = {
  heroImageUrl: string | null
  productPhotos: string[] | null
}

type StoredImageEntry = {
  storedUrl: string
  isHeroImage: boolean
}

export function linkColumnFor(field: LinkField): LinkColumn {
  return LINK_FIELD_TO_COLUMN[field]
}

const CORPORATE_ACCOUNT_PATTERNS = [
  /instagram\.com\/ilovepinkoi/i,
  /facebook\.com\/ilovepinkoi/i,
  /threads\.net\/@ilovepinkoi/i,
  /instagram\.com\/shopee_tw/i,
  /facebook\.com\/shopee\.tw/i,
]

const FACEBOOK_SYSTEM_PATHS = [
  'about',
  'ads',
  'business',
  'commerce',
  'events',
  'friends',
  'gaming',
  'groups',
  'help',
  'home',
  'login',
  'marketplace',
  'messages',
  'notifications',
  'pages',
  'policies',
  'privacy',
  'public',
  'reels',
  'search',
  'settings',
  'share',
  'sharer',
  'stories',
  'terms',
  'watch',
  'docs',
]

const FACEBOOK_PROFILE_URL_PATTERN = new RegExp(
  `facebook\\.com\\/(?!${FACEBOOK_SYSTEM_PATHS.join('|')}(?:[/?#]|$))[^/?#]+\\/?$`,
  'i'
)

const URL_TO_LINK_COLUMN: Array<{ pattern: RegExp; column: LinkColumn }> = [
  { pattern: /instagram\.com\/[^/?#]+\/?$/i, column: 'social_instagram' },
  { pattern: /threads\.net\/@[^/?#]+\/?$/i, column: 'social_threads' },
  { pattern: FACEBOOK_PROFILE_URL_PATTERN, column: 'social_facebook' },
  { pattern: /pinkoi\.com\/store\/[^/?#]+/i, column: 'purchase_pinkoi' },
  { pattern: /shopee\.tw\/[^/?#]+$/i, column: 'purchase_shopee' },
]

type LinkEnrichScraped =
  | Partial<Pick<ScrapedBrandData, LinkField>>
  | Partial<BrandFlatLinkColumns>

type TextEnrichBrand = {
  description?: string | null
  brand_highlights?: string | null
}

type TextEnrichScraped = Partial<Pick<ScrapedBrandData, 'description' | 'story'>>

type TextEnrichPatch = {
  description?: string
  brand_highlights?: string
}

export function hasLinkValue(value: string | null | undefined): value is string {
  return value != null && value.trim() !== ''
}

function isCorporateAccount(url: string): boolean {
  return CORPORATE_ACCOUNT_PATTERNS.some((pattern) => pattern.test(url))
}

export function extractLinksFromUrls(urls: string[]): Partial<BrandFlatLinkColumns> {
  const result: Partial<BrandFlatLinkColumns> = {}

  for (const url of urls) {
    if (isCorporateAccount(url)) {
      continue
    }

    for (const { pattern, column } of URL_TO_LINK_COLUMN) {
      if (!result[column] && pattern.test(url)) {
        result[column] = url
      }
    }
  }

  return result
}

const COLUMN_TO_FIELD = Object.fromEntries(
  Object.entries(LINK_FIELD_TO_COLUMN).map(([field, column]) => [column, field])
) as Record<LinkColumn, LinkField>

export function classifySubmittedUrl(url: string): Partial<Record<LinkField, string>> {
  const extracted = extractLinksFromUrls([url])
  const columns = Object.keys(extracted) as LinkColumn[]

  if (columns.length > 0) {
    const column = columns[0]
    const field = COLUMN_TO_FIELD[column]
    return { [field]: extracted[column] }
  }

  const matchesPattern = URL_TO_LINK_COLUMN.some(({ pattern }) => pattern.test(url))
  if (matchesPattern) {
    // Matched a known platform pattern but was filtered (e.g. corporate account)
    return {}
  }

  return { purchaseWebsite: url }
}

export function buildLinkEnrichPatch(
  brand: BrandFlatLinkColumns,
  scraped: LinkEnrichScraped
): Partial<BrandFlatLinkColumns> {
  const patch: Partial<BrandFlatLinkColumns> = {}

  for (const field of LINK_FIELDS) {
    const column = linkColumnFor(field)
    const existingValue = brand[column]
    const scrapedValue = getScrapedLinkValue(scraped, field, column)

    if (hasLinkValue(existingValue) && isCorporateAccount(existingValue)) {
      patch[column] = hasLinkValue(scrapedValue) && !isCorporateAccount(scrapedValue)
        ? scrapedValue
        : null
      continue
    }

    if (!hasLinkValue(scrapedValue) || isCorporateAccount(scrapedValue)) {
      continue
    }

    if (!hasLinkValue(existingValue) || existingValue !== scrapedValue) {
      patch[column] = scrapedValue
    }
  }

  return patch
}

export function buildTextEnrichPatch(
  brand: TextEnrichBrand,
  scraped: TextEnrichScraped
): TextEnrichPatch {
  const patch: TextEnrichPatch = {}

  if (
    (!brand.description || brand.description.length < 20)
    && scraped.description
    && scraped.description.length >= 20
  ) {
    patch.description = scraped.description
  }

  if (brand.brand_highlights == null && scraped.story) {
    patch.brand_highlights = scraped.story
  }

  return patch
}

export function buildImageEnrichPatch(
  brand: ImageEnrichBrand,
  storedUrls: Array<string | null>
): Partial<Pick<Brand, 'heroImageUrl' | 'productPhotos'>>
export function buildImageEnrichPatch(
  brand: ImageEnrichBrand,
  scraped: Pick<ScrapedBrandData, 'heroImageUrl' | 'galleryImageUrls'>,
  storedUrls: Array<string | null>
): Partial<Pick<Brand, 'heroImageUrl' | 'productPhotos'>>
export function buildImageEnrichPatch(
  brand: ImageEnrichBrand,
  scrapedOrStoredUrls: Pick<ScrapedBrandData, 'heroImageUrl' | 'galleryImageUrls'> | Array<string | null>,
  maybeStoredUrls?: Array<string | null>
): Partial<Pick<Brand, 'heroImageUrl' | 'productPhotos'>> {
  const patch: Partial<Pick<Brand, 'heroImageUrl' | 'productPhotos'>> = {}
  const storedImageEntries = Array.isArray(scrapedOrStoredUrls)
    ? buildStoredImageEntries(scrapedOrStoredUrls)
    : buildScrapedImageEntries(scrapedOrStoredUrls, maybeStoredUrls ?? [])

  if (storedImageEntries.length === 0) {
    return patch
  }

  const promotedHeroUrl = storedImageEntries[0].storedUrl
  if (!brand.heroImageUrl && promotedHeroUrl) {
    patch.heroImageUrl = promotedHeroUrl
  }

  const newProductPhotos = storedImageEntries
    .filter((entry) => entry.storedUrl !== promotedHeroUrl)
    .map((entry) => entry.storedUrl)

  if (newProductPhotos.length > 0) {
    const existingPhotos = brand.productPhotos ?? []
    const merged = [...existingPhotos, ...newProductPhotos]
    patch.productPhotos = merged.slice(0, MAX_PRODUCT_PHOTOS)
  }

  return patch
}

function buildStoredImageEntries(storedUrls: Array<string | null>): StoredImageEntry[] {
  return storedUrls
    .filter(hasLinkValue)
    .map((storedUrl, index) => ({
      storedUrl,
      isHeroImage: index === 0,
    }))
}

function buildScrapedImageEntries(
  scraped: Pick<ScrapedBrandData, 'heroImageUrl' | 'galleryImageUrls'>,
  storedUrls: Array<string | null>
): StoredImageEntry[] {
  const galleryImageUrls = scraped.galleryImageUrls.filter(hasLinkValue)
  const hasScrapedHero = hasLinkValue(scraped.heroImageUrl)
  const imageUrls = [
    scraped.heroImageUrl,
    ...galleryImageUrls,
  ].filter(hasLinkValue)

  if (imageUrls.length === 0) {
    return []
  }

  const galleryStoredUrlOffset = hasScrapedHero ? 1 : 0

  return [
    ...(hasScrapedHero
      ? [{ storedUrl: storedUrls[0], isHeroImage: true }]
      : []),
    ...galleryImageUrls.map((_, index) => ({
      storedUrl: storedUrls[galleryStoredUrlOffset + index],
      isHeroImage: false,
    })),
  ].filter((entry): entry is StoredImageEntry => hasLinkValue(entry.storedUrl))
}

function getScrapedLinkValue(
  scraped: LinkEnrichScraped,
  field: LinkField,
  column: LinkColumn
): string | null | undefined {
  const flatScraped = scraped as Partial<BrandFlatLinkColumns>
  if (column in flatScraped) {
    return flatScraped[column]
  }

  return (scraped as Partial<Pick<ScrapedBrandData, LinkField>>)[field]
}
