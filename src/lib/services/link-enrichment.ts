import type { Brand, BrandFlatLinkColumns } from '@/lib/types'
import type { ScrapedBrandData } from '@/lib/types/scraper'
import { isNonBrandSiteHost } from './enrich-phases/scraper/input-detector'

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
  /threads\.(?:net|com)\/@ilovepinkoi/i,
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
  // Both Threads hosts: a threads.com URL that matched nothing here fell
  // through `classifySubmittedUrl` into `purchaseWebsite`, which is how the
  // platform root ended up standing in for 22 brands' own websites.
  { pattern: /threads\.(?:net|com)\/@[^/?#]+\/?$/i, column: 'social_threads' },
  { pattern: FACEBOOK_PROFILE_URL_PATTERN, column: 'social_facebook' },
  { pattern: /pinkoi\.com\/store\/[^/?#]+/i, column: 'purchase_pinkoi' },
  { pattern: /shopee\.tw\/[^/?#]+$/i, column: 'purchase_shopee' },
]

type LinkEnrichScraped =
  | Partial<Pick<ScrapedBrandData, LinkField>>
  | Partial<BrandFlatLinkColumns>

type TextEnrichBrand = {
  description?: string | null
}

type TextEnrichScraped = Partial<Pick<ScrapedBrandData, 'description' | 'story'>>

type TextEnrichPatch = {
  description?: string
}

export function hasLinkValue(value: string | null | undefined): value is string {
  return value != null && value.trim() !== ''
}

function isCorporateAccount(url: string): boolean {
  return CORPORATE_ACCOUNT_PATTERNS.some((pattern) => pattern.test(url))
}

const THREADS_LEGACY_HOST = 'threads.net'

/**
 * Rewrites a threads.net hostname to threads.com, preserving path and query.
 * Meta migrated the platform and threads.net now redirects, so threads.com is
 * the canonical destination — writing it means stored links stop costing every
 * reader a redirect hop, and the two hosts stop looking like two distinct
 * values to change detection.
 *
 * Only the host changes: `www.threads.net/@brand?x=1` becomes
 * `www.threads.com/@brand?x=1`. Anything that is not a threads.net URL —
 * including a malformed string or a bare handle — is returned unchanged. This
 * never throws.
 */
export function canonicalizeThreadsUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const hostname = parsed.hostname.toLowerCase()
    if (hostname !== THREADS_LEGACY_HOST && !hostname.endsWith(`.${THREADS_LEGACY_HOST}`)) {
      return url
    }

    const subdomain = hostname.slice(0, hostname.length - THREADS_LEGACY_HOST.length)
    parsed.hostname = `${subdomain}threads.com`
    return parsed.toString()
  } catch {
    return url
  }
}

/**
 * Marketplace paths that are a *query*, not a seller. A brand's own site
 * frequently links its Shopee presence as a keyword search rather than as its
 * storefront, and that URL is indistinguishable from a real store to every
 * pattern that only checks the host — a `shopee.tw/search?keyword=…` URL
 * carrying the brand's name was written to Major Pleasure's `purchase_shopee`
 * on a live run. It renders
 * as a buy link, sends the reader to a page of other sellers' listings, and
 * breaks the moment Shopee changes its ranking.
 *
 * Matched on pathname only, so an added tracking query string cannot slip a
 * search page past. A malformed URL is rejected: this gate is only ever
 * consulted for values we are about to publish as purchase links.
 */
const MARKETPLACE_SEARCH_PATHS = [
  '/search',
  '/find',
  '/mall/search',
  '/browse',
  '/product-search',
  '/collections/all',
]

export function isMarketplaceSearchUrl(url: string): boolean {
  try {
    const { pathname, searchParams } = new URL(url)
    const path = pathname.toLowerCase().replace(/\/+$/, '')
    if (MARKETPLACE_SEARCH_PATHS.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
      return true
    }
    // A bare host carrying only a search term is the same page under a
    // different route (`pinkoi.com/?q=...`).
    return path === '' && (searchParams.has('keyword') || searchParams.has('q'))
  } catch {
    return true
  }
}

/**
 * Per-field cleanup applied to a scraped value before it is compared with, and
 * possibly written over, what the row already holds.
 *
 * `purchaseWebsite` is dropped rather than rewritten: a social, marketplace, or
 * link-aggregator host is not the brand's own site, and once one lands in that
 * column the image phase issues `site:{platform} {name}` — searching the whole
 * platform instead of the brand. Returning null here means the existing value
 * survives untouched; we decline to write, we do not clobber.
 *
 * The two marketplace columns are dropped on the same terms when the URL is a
 * search page rather than a storefront.
 */
function normalizeScrapedLinkValue(
  field: LinkField,
  value: string | null | undefined
): string | null | undefined {
  if (!hasLinkValue(value)) return value
  if (field === 'socialThreads') return canonicalizeThreadsUrl(value)
  if (field === 'purchaseWebsite' && isNonBrandSiteHost(value)) return null
  if (
    (field === 'purchaseShopee' || field === 'purchasePinkoi') &&
    isMarketplaceSearchUrl(value)
  ) {
    return null
  }
  return value
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

  // Last resort is "it must be their own website" — but a platform URL that no
  // pattern above recognised (a Threads post rather than a profile, a link
  // aggregator, a marketplace search page) is not one. Claiming it here is what
  // seeded `purchase_website` with hosts the image phase then searches whole.
  if (isNonBrandSiteHost(url)) {
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
    const scrapedValue = normalizeScrapedLinkValue(
      field,
      getScrapedLinkValue(scraped, field, column)
    )

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
  void brand
  void scraped

  const patch: TextEnrichPatch = {}

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
