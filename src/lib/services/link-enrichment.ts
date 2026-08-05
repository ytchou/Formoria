import type { Brand, BrandFlatLinkColumns } from '@/lib/types'
import type { ScrapedBrandData } from '@/lib/types/scraper'
import {
  PURCHASE_CAMEL_FIELDS,
  PURCHASE_CHANNELS,
  type PurchaseChannelCamelField,
  type PurchaseChannelColumn,
} from '@/lib/brands/purchase-channels'
import { isNonBrandSiteHost } from './enrich-phases/scraper/input-detector'

const MAX_PRODUCT_PHOTOS = 5

// Socials stay listed here — they have no registry. The purchase half is spliced
// in from `PURCHASE_CHANNELS`, and the order (socials first, then purchase in
// registry order) is preserved verbatim.
export const LINK_FIELDS = [
  'socialInstagram',
  'socialThreads',
  'socialFacebook',
  ...PURCHASE_CAMEL_FIELDS,
] as const

export type LinkField = (typeof LINK_FIELDS)[number]
export type LinkColumn = Exclude<keyof BrandFlatLinkColumns, 'other_urls'>

const LINK_FIELD_TO_COLUMN: Record<LinkField, LinkColumn> = {
  socialInstagram: 'social_instagram',
  socialThreads: 'social_threads',
  socialFacebook: 'social_facebook',
  ...(Object.fromEntries(
    PURCHASE_CHANNELS.map((channel) => [channel.camel, channel.column])
  ) as Record<PurchaseChannelCamelField, PurchaseChannelColumn>),
}

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
  // Purchase patterns come from the registry, in registry order. A channel with
  // no pattern (`website`) is the fallback bucket, never a match target — see
  // `classifySubmittedUrl` below.
  ...PURCHASE_CHANNELS.flatMap((channel) =>
    channel.urlPattern ? [{ pattern: channel.urlPattern, column: channel.column }] : []
  ),
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
 * The non-empty path segments of a URL, or null when the value will not parse.
 * Every path-shape rule below reads this rather than slicing the string: a
 * trailing slash, a duplicated slash, and a query string are all noise, and the
 * rules that follow are the last gate before a value is published as a link.
 */
export function urlPathSegments(url: string): string[] | null {
  try {
    return new URL(url).pathname.split('/').filter(Boolean)
  } catch {
    return null
  }
}

/**
 * True when the URL addresses a platform's front door rather than an account on
 * it — `https://www.instagram.com/` and `https://www.instagram.com` both count,
 * and a malformed value counts too (we never publish what we cannot parse).
 *
 * A curation refresh wrote `https://www.pinkoi.com/` into `purchase_pinkoi` on a
 * brand that had none, so the brand page grew a "buy on Pinkoi" link that lands
 * the reader on Pinkoi's homepage. A platform root is never a brand's channel:
 * it identifies the platform, not the seller.
 */
export function isBareRootUrl(url: string): boolean {
  const segments = urlPathSegments(url)
  return segments === null || segments.length === 0
}

/**
 * True only for a Pinkoi *storefront* — `/store/{seller}` — mirroring the
 * `purchase_pinkoi` pattern in `URL_TO_LINK_COLUMN` above. Pinkoi's product,
 * campaign, and browse pages all live under the same host and all render as a
 * plausible buy link, but none of them is the brand's storefront; the same run
 * that produced the bare root above also had nothing stopping a non-store path.
 */
export function isPinkoiStorefrontUrl(url: string): boolean {
  const segments = urlPathSegments(url)
  if (segments === null) return false
  const storeIndex = segments.indexOf('store')
  return storeIndex !== -1 && (segments.at(storeIndex + 1) ?? '') !== ''
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
 * search page rather than a storefront, when it is a platform root, and — for
 * Pinkoi — when the path is not a `/store/{seller}` page at all.
 *
 * The social columns reject a platform root for the same reason: a scrape that
 * only found `https://www.facebook.com/` learned nothing about the brand, and
 * writing it both publishes a dead link and destroys whatever handle the column
 * already held.
 *
 * `purchaseWebsite` is deliberately exempt from the bare-root rule: a brand's
 * own site legitimately IS a bare origin — `deriveOfficialWebsite` returns
 * origins by design — so the only bare roots to reject there are platform ones,
 * which `isNonBrandSiteHost` already covers on any path.
 */
const BARE_ROOT_REJECTING_FIELDS: readonly LinkField[] = [
  'socialInstagram',
  'socialThreads',
  'socialFacebook',
  ...PURCHASE_CHANNELS.filter((channel) => !channel.allowBareRoot).map(
    (channel) => channel.camel
  ),
]

function normalizeScrapedLinkValue(
  field: LinkField,
  value: string | null | undefined
): string | null | undefined {
  if (!hasLinkValue(value)) return value
  if (field === 'purchaseWebsite') {
    return isNonBrandSiteHost(value) ? null : value
  }
  if (BARE_ROOT_REJECTING_FIELDS.includes(field) && isBareRootUrl(value)) {
    return null
  }
  const purchaseChannel = PURCHASE_CHANNELS.find((channel) => channel.camel === field)
  if (purchaseChannel?.urlPattern && !purchaseChannel.urlPattern.test(value)) {
    return null
  }
  if (field === 'purchasePinkoi' && !isPinkoiStorefrontUrl(value)) {
    return null
  }
  if (
    (field === 'purchaseShopee' || field === 'purchasePinkoi') &&
    isMarketplaceSearchUrl(value)
  ) {
    return null
  }
  if (field === 'socialThreads') return canonicalizeThreadsUrl(value)
  return value
}

/**
 * Latin tokens of a brand name, long enough to be an identity fingerprint. CJK
 * characters cannot appear in a domain or a platform handle, so they are dropped
 * rather than transliterated; a purely Han name simply yields no tokens and each
 * caller falls back to its own no-signal behaviour.
 *
 * Lives here rather than in `enrich-phases/links.ts` because both that module
 * and this one need it, and links.ts already imports from here — the reverse
 * import would be a cycle.
 */
export function brandNameTokens(brandName: string | null | undefined): string[] {
  if (!brandName) return []
  return brandName
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3)
}

/**
 * The account segment a platform URL identifies: the seller for a Pinkoi
 * storefront, the handle for everything else, with the Threads `@` stripped.
 */
function platformHandleSegment(url: string): string | null {
  const segments = urlPathSegments(url)
  if (segments === null || segments.length === 0) return null
  const storeIndex = segments.indexOf('store')
  const handle = storeIndex !== -1 ? segments.at(storeIndex + 1) : segments.at(0)
  if (!handle) return null
  return handle.replace(/^@/, '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Whether a platform handle plausibly belongs to this brand.
 *
 * Every URL reaching `extractLinksFromUrls` came out of a SERP for the brand's
 * name, and a SERP answers "what ranks for these words", not "what does this
 * brand own". `https://www.facebook.com/threebrothersboards/` was adopted as the
 * Taiwanese brand "One Wood"'s Facebook page on a live run purely because it
 * ranked — a different company, published on the brand's page with no identity
 * check anywhere between the search result and the column.
 *
 * Containment in either direction, because neither string is authoritative: a
 * handle padded for uniqueness (`one.wood.100`) contains the token, while a
 * handle that abbreviates (`su3`) is contained by one. A name with no Latin
 * tokens gives us nothing to discriminate with, so it accepts — same fallback
 * `deriveOfficialWebsite` makes for the same reason.
 */
function handleMatchesBrand(url: string, tokens: string[]): boolean {
  if (tokens.length === 0) return true
  const handle = platformHandleSegment(url)
  if (!handle) return false
  return tokens.some((token) => handle.includes(token) || token.includes(handle))
}

/**
 * `brandName` is optional and additive: without it the function behaves exactly
 * as it always has (`classifySubmittedUrl` below depends on that — a URL a human
 * submitted for a specific brand needs no SERP-identity gate). With it, every
 * platform URL here must carry a handle that plausibly belongs to the brand.
 */
export function extractLinksFromUrls(
  urls: string[],
  brandName?: string | null
): Partial<BrandFlatLinkColumns> {
  const result: Partial<BrandFlatLinkColumns> = {}
  const tokens = brandName == null ? null : brandNameTokens(brandName)

  for (const url of urls) {
    if (isCorporateAccount(url)) {
      continue
    }

    if (tokens !== null && !handleMatchesBrand(url, tokens)) {
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

/** Hostname without scheme, case, or a leading `www.` — the identity of a site. */
function bareHostname(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
}

/**
 * True when replacing `existing` with `scraped` would trade a specific page on a
 * host for a vaguer one on the SAME host.
 *
 * A curation refresh overwrote `https://www.pinkoi.com/store/guaguaforest` — a
 * real storefront, correct, human-verified — with `https://www.pinkoi.com/`,
 * because the two values merely differed and "differs" was the whole test. The
 * good link was destroyed by a run whose only new information was that Pinkoi
 * exists. Path depth is the available proxy for specificity: on one host, more
 * segments means the URL names something narrower, and a re-scrape that comes
 * back with less than we already store is a loss, not an update.
 *
 * Deliberately scoped to the same host. A genuine cross-host correction (the
 * brand moved from a Shopify subdomain to its own domain) carries real new
 * information and must still go through, as must an equally deep change on one
 * host (`/store/old` -> `/store/new`, a genuine rename).
 */
function isSpecificityDowngrade(
  existingValue: string | null | undefined,
  scrapedValue: string
): boolean {
  if (!hasLinkValue(existingValue)) return false
  const existingHost = bareHostname(existingValue)
  const scrapedHost = bareHostname(scrapedValue)
  if (existingHost === null || scrapedHost === null || existingHost !== scrapedHost) {
    return false
  }

  const existingSegments = urlPathSegments(existingValue) ?? []
  const scrapedSegments = urlPathSegments(scrapedValue) ?? []
  return existingSegments.length > scrapedSegments.length
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
      if (isSpecificityDowngrade(existingValue, scrapedValue)) {
        continue
      }
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
