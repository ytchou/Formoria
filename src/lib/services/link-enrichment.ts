import type { Brand, BrandFlatLinkColumns } from '@/lib/types'
import type { ScrapedBrandData } from '@/lib/types/scraper'
export {
  LINK_FIELDS,
  type LinkColumn,
  type LinkField,
} from '@/lib/types/link-fields'
import {
  LINK_FIELDS,
  LINK_FIELD_TO_COLUMN,
  type LinkColumn,
  type LinkField,
} from '@/lib/types/link-fields'
import {
  PURCHASE_CHANNELS,
} from '@/lib/brands/purchase-channels'
import { isNonBrandSiteHost } from './enrich-phases/scraper/input-detector'

const MAX_PRODUCT_PHOTOS = 5

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

/** Identity for "is this the same page?" - scheme, `www.`, and a trailing slash are noise. */
export function scrapeKey(url: string): string {
  const trimmed = url.trim().toLowerCase()
  try {
    const parsed = new URL(trimmed)
    return `${parsed.hostname.replace(/^www\./, '')}${parsed.pathname.replace(/\/+$/, '')}`
  } catch {
    return trimmed.replace(/\/+$/, '')
  }
}

/**
 * The canonical key for one scraped page. Threads is canonicalized first because
 * threads.net redirects to threads.com, so the two spellings name one page.
 * Applying `scrapeKey` to an already-canonical key is idempotent, so a legacy
 * value that was stored as a full URL and a new value stored as a key both
 * resolve here to the same string.
 */
export function pageKey(url: string): string {
  return scrapeKey(canonicalizeThreadsUrl(url))
}

/** The host portion of a `pageKey`, for a subject that owns its whole domain. */
export function pageKeyHost(url: string): string {
  return pageKey(url).split('/')[0] ?? ''
}

export function sameUrl(a: string, b: string): boolean {
  return pageKey(a) === pageKey(b)
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
function urlPathSegments(url: string): string[] | null {
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
  // Deliberately NOT gated on `channel.urlPattern`: that pattern is the strict
  // classifier for *submitted* URLs (`URL_TO_LINK_COLUMN`), and applying it to
  // scraped values drops legitimate storefronts (`shopee.com.tw/mybrand`,
  // tracking query strings, deeper paths) — and, worse, returns null for a
  // column the brand already holds, which `buildLinkEnrichPatch` then erases.
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
 * Lives here because both the links phase and this module need it, and the
 * links phase already imports from here — the reverse import would be a cycle.
 */
export function brandNameTokens(brandName: string | null | undefined): string[] {
  if (!brandName) return []
  return brandName
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3)
}

/**
 * Public-suffix labels we strip before looking for the brand's name in a host,
 * so a brand token never matches the TLD itself. Not a full PSL — the list only
 * needs to cover the suffixes Taiwanese brands actually register under.
 */
const PUBLIC_SUFFIX_SECOND_LEVELS = new Set(['com', 'co', 'net', 'org', 'gov', 'edu', 'idv'])

/** The name-bearing labels of a host: `www.cha-tzu.com.tw` -> `chatzu`. */
function domainNameLabels(hostname: string): string {
  const labels = hostname.replace(/^www\./, '').split('.').filter(Boolean)
  let end = labels.length - 1
  if (end > 0 && PUBLIC_SUFFIX_SECOND_LEVELS.has(labels.at(end - 1) ?? '')) {
    end -= 1
  }
  return labels.slice(0, Math.max(end, 1)).join('').replace(/[^a-z0-9]/g, '')
}

/**
 * Two-letter TLDs a Taiwanese brand plausibly registers under. `tw` is the home
 * ccTLD; `co` and `io` are two-letter by accident of the DNS and are used as
 * generic startup TLDs worldwide, Taiwan included.
 */
const ALLOWED_TWO_LETTER_TLDS = new Set(['tw', 'co', 'io'])

/**
 * True for a host under a foreign country's ccTLD.
 *
 * This is a Taiwan-only brand directory, and a SERP for a short Latin brand name
 * routinely surfaces a same-named foreign company: `https://onewood.dk`, a
 * Danish firm, became the Taiwanese brand "One Wood"'s official website on a
 * live run, and it passed every guard we had — the host is not a platform, and
 * the domain does carry the brand's tokens, because the two companies genuinely
 * share a name. Nationality is the only signal that separates them.
 *
 * Only two-letter TLDs are judged: every generic TLD (`.com`, `.shop`,
 * `.store`, `.design`, `.studio`, …) is registrable from Taiwan and says nothing
 * about nationality, so those pass untouched. `.com.tw` ends in `tw` and passes.
 * A malformed URL is not rejected here — unknown, not blocked, matching
 * `isNonBrandSiteHost`.
 */
export function isForeignCountryTld(url: string): boolean {
  try {
    const tld = new URL(url).hostname.toLowerCase().split('.').at(-1) ?? ''
    return tld.length === 2 && !ALLOWED_TWO_LETTER_TLDS.has(tld)
  } catch {
    return false
  }
}

/**
 * True for government and university hosts. A Han-only-named brand's SERP can
 * surface government and university pages that mention it, and those pages were
 * being adopted as the brand's own site or purchase channel. Government and
 * education domains are blocked because institutional ownership is distinct from
 * commercial brand ownership. A malformed URL is not rejected here - unknown,
 * not blocked.
 */
export function isInstitutionalHost(url: string): boolean {
  try {
    const labels = new URL(url).hostname.toLowerCase().split('.')
    const last = labels.at(-1)
    if (last === 'gov' || last === 'edu') return true
    const secondLevel = labels.at(-2)
    return last === 'tw' && (secondLevel === 'gov' || secondLevel === 'edu')
  } catch {
    return false
  }
}

export function hostMatchesBrandName(url: string, tokens: string[]): boolean {
  if (tokens.length === 0) return false
  try {
    const domain = domainNameLabels(new URL(url).hostname.toLowerCase())
    return tokens.some((token) => domain.includes(token))
  } catch {
    return false
  }
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
export function handleMatchesBrand(url: string, tokens: string[]): boolean {
  if (tokens.length === 0) return true
  const handle = platformHandleSegment(url)
  if (!handle) return false
  return tokens.some((token) => handle.includes(token) || token.includes(handle))
}

/**
 * Confirms a link only when its platform handle or registrable host identifies
 * the brand. `https://www.facebook.com/NaHoku` — a Hawaiian jewellery company —
 * was harvested off `nahoku.com`'s footer and written into NU Dream Jewelry's
 * `social_facebook`, so either side of the link must carry the brand identity.
 *
 * This predicate only ever CONFIRMS: zero tokens means "not confirmed", the
 * deliberate opposite polarity from `handleMatchesBrand`, because a caller
 * that cannot confirm must escalate (quarantine), never delete.
 */
export function linkIdentifiesBrand(url: string, tokens: string[]): boolean {
  if (tokens.length === 0) return false // NOT confirmed -> caller escalates
  return handleMatchesBrand(url, tokens) || hostMatchesBrandName(url, tokens)
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
  if (isNonBrandSiteHost(url) || isInstitutionalHost(url)) {
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

/**
 * Social fields the brand-identity gate below applies to.
 *
 * Deliberately socials only. A marketplace storefront is already path-gated
 * (`/store/{seller}`, no search pages), and marketplace handles are routinely
 * opaque IDs — `s.shopee.tw/4VHrii96Af` carries no brand token and is still the
 * brand's own store, so an identity gate there would reject legitimate links.
 * Socials are where the contamination concentrates and where a handle is
 * expected to read like the brand.
 */
const IDENTITY_GATED_FIELDS: readonly LinkField[] = [
  'socialInstagram',
  'socialThreads',
  'socialFacebook',
]

/**
 * `brandName` is optional and additive, mirroring `extractLinksFromUrls`.
 *
 * With it, a SCRAPED social handle must plausibly belong to the brand. The SERP
 * path has been gated since DEV-1309, but the scrape path was not, and it is the
 * one that actually contaminated the directory: a page the brand does not own —
 * a trade-show exhibitor listing, a retailer's brand page — carries the SITE
 * OWNER's social accounts, and the scraper adopted them verbatim. One expo
 * listing put the same illustrator's Facebook page on 23 unrelated brands, and
 * @cosme Taiwan's accounts onto five of the brands it stocks (DEV-1332).
 *
 * A rejected value is skipped, never written as null: declining to fill is not
 * the same as erasing what the row already holds.
 *
 * `identityConfirmedFields` exempts a field whose SOURCE PAGE the caller has
 * already confirmed belongs to the brand. The handle gate above reads the
 * handle alone, which is the wrong question for a brand whose own site carries
 * a handle that abbreviates its name — `74OUNCE` -> `instagram.com/74oz`,
 * `Darker Than Black Bags` -> `dtbbag.com`. That class measured 51 rows, so
 * gating it on the handle would decline to fill legitimate socials. The links
 * phase confirms a source page via `knownUrls` or `linkIdentifiesBrand` and
 * passes the resulting fields here; everything unconfirmed still faces the
 * gate, and the site_identity phase arbitrates what neither rule can decide
 * (DEV-1309 x DEV-1332).
 */
export function buildLinkEnrichPatch(
  brand: BrandFlatLinkColumns,
  scraped: LinkEnrichScraped,
  brandName?: string | null,
  identityConfirmedFields?: ReadonlySet<LinkField>
): Partial<BrandFlatLinkColumns> {
  const patch: Partial<BrandFlatLinkColumns> = {}
  const tokens = brandName == null ? null : brandNameTokens(brandName)

  for (const field of LINK_FIELDS) {
    const column = linkColumnFor(field)
    const existingValue = brand[column]
    const normalizedValue = normalizeScrapedLinkValue(
      field,
      getScrapedLinkValue(scraped, field, column)
    )
    // A handle that fails the identity gate is treated as "we scraped nothing",
    // not as a value to write. That keeps the corporate-account branch below
    // intact: an existing corporate handle is still cleared, it just is not
    // replaced by a second stranger's account.
    const scrapedValue =
      tokens !== null &&
      hasLinkValue(normalizedValue) &&
      IDENTITY_GATED_FIELDS.includes(field) &&
      !identityConfirmedFields?.has(field) &&
      !handleMatchesBrand(normalizedValue, tokens)
        ? null
        : normalizedValue

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
