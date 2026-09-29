import { CLEARED_FIELDS_KEY } from '../brand-write-policy'
import type { ScrapedImageSource } from '@/lib/types/scraper'
import type { PhaseResult } from '@/lib/types/curation'
import { buildPhaseResult, type EnrichBrand, type EnrichPatch } from './types'
import type { EnrichScrapedData } from './types'
import type { QuarantineGroup } from './acquire'
import { pageKey } from '../link-enrichment'

/**
 * The image payload a revocation may strike from.
 *
 * Structural rather than `AcquirePhaseOutput` so the acquire phase can revoke
 * against the arrays it is still assembling, before the output object exists.
 * `AcquirePhaseOutput` satisfies it, so every existing caller is unchanged —
 * and the acquire → site-identity import stops needing a value-level cycle.
 */
export type RevokableImagePayload = {
  scrapedImageUrls: string[]
  scrapedImageSources: ScrapedImageSource[]
  jsonLdImageUrls: string[]
  scrapedData?: EnrichScrapedData | null
}

export type SiteIdentityQuarantine = QuarantineGroup & {
  patch: EnrichPatch
  /**
   * The SAME object the caller holds as `state.scrapedData` (see
   * `curation-operations`), not a copy — `revokeText` mutates it in place so the
   * downstream phases (faq, descriptions), which run after this one, never see
   * text from a page judged not-owned. Do not spread it on the way in.
   */
  scrapedData?: EnrichScrapedData
  linksResult?: RevokableImagePayload | null
}

/** One page-ownership verdict, keyed by `siteIdentityKey(slug, subjectUrl)`. */
export type SiteIdentityVerdict = {
  slug: string
  owned: boolean
  confidence: 'high' | 'medium' | 'low'
  reason: string
}

/**
 * Keys a verdict by `slug + subjectUrl`: a brand can quarantine both a `website`
 * subject and a `source-page` subject, so a slug-only key would let one
 * subject's verdict revoke the other.
 */
export function siteIdentityKey(slug: string, subjectUrl: string): string {
  return slug + ' ' + subjectUrl
}

type SiteIdentityApplication = {
  phaseResult: PhaseResult
  removedColumns: string[]
  clearedFields: string[]
  patch: EnrichPatch
  detailParts: string[]
}

export function resolveQuarantine(
  verdict: SiteIdentityVerdict | undefined,
): { revoked: boolean; reason: string } {
  if (!verdict) return { revoked: false, reason: 'provider-failure' }
  if (verdict.confidence === 'high' && verdict.owned === false) {
    return { revoked: true, reason: verdict.reason }
  }
  return {
    revoked: false,
    reason: verdict.confidence === 'high' ? 'owned' : verdict.confidence,
  }
}

function clearedFieldsPatch(clearedFields: string[]): EnrichPatch {
  return clearedFields.length > 0 ? { [CLEARED_FIELDS_KEY]: clearedFields } : {}
}

/**
 * Turn the acquisition agent's critique verdicts into site-identity verdicts,
 * keyed the way `resolveQuarantine`/`applyRevocation` expect to read them.
 *
 * The agent already looks at every page it fetched and says whether the brand
 * owns it, so re-asking a second model the same question costs a call and adds
 * a way for the two answers to disagree. This adapter is the whole difference
 * between the two vocabularies:
 *
 *   - the critique names the URL it was SHOWN; the quarantine names the subject
 *     URL the scrape recorded. `pageKey` is the same normalizer the scrape path
 *     keys pages by, so scheme, `www.` and a trailing slash cannot split one
 *     page into two.
 *   - a verdict matching no quarantine group is dropped. Ownership of a page we
 *     took no value from decides nothing, and a revocation keyed to a group that
 *     does not exist would silently do nothing anyway.
 *
 * First verdict wins per subject: a repeated URL is the model restating itself,
 * and letting the later copy overwrite the earlier one would make the outcome
 * depend on array order.
 */
export function verdictsFromCritique(
  urlVerdicts: ReadonlyArray<{
    url: string
    owned: boolean
    confidence: 'high' | 'medium' | 'low'
    reason: string
  }>,
  brandSlug: string,
  quarantine: Record<string, QuarantineGroup>,
): Map<string, SiteIdentityVerdict> {
  const verdicts = new Map<string, SiteIdentityVerdict>()
  const subjectByKey = new Map<string, string>()
  for (const group of Object.values(quarantine)) {
    const key = pageKey(group.subjectUrl)
    if (!subjectByKey.has(key)) subjectByKey.set(key, group.subjectUrl)
  }

  for (const verdict of urlVerdicts) {
    const subjectUrl = subjectByKey.get(pageKey(verdict.url))
    if (!subjectUrl) continue
    const key = siteIdentityKey(brandSlug, subjectUrl)
    if (verdicts.has(key)) continue
    verdicts.set(key, {
      slug: brandSlug,
      owned: verdict.owned,
      confidence: verdict.confidence,
      reason: verdict.reason,
    })
  }

  return verdicts
}

export function applyRevocation(
  brand: EnrichBrand,
  quarantine: SiteIdentityQuarantine,
  reason: string,
  options: { columns?: string[]; revokeHostContent?: boolean } = {},
): SiteIdentityApplication {
  const { removedColumns, newlyCleared, clearedFields } = revokeFields(quarantine, brand, options.columns)
  // Images and DEV-1367's text revoke are both whole-host actions justified by a
  // verdict. A caller revoking without a verdict opts out of both.
  const revokeHostContent = options.revokeHostContent ?? true
  const revokedText = revokeHostContent
    ? revokeText(quarantine, quarantine.subjectUrl, quarantine.subjectKind)
    : []
  if (revokeHostContent) {
    filterRevokedImages(quarantine.linksResult, quarantine.subjectUrl, quarantine.subjectKind)
  }
  return {
    phaseResult: buildPhaseResult(
      'site_identity',
      'succeeded',
      [...removedColumns, ...newlyCleared, ...revokedText],
      0,
      undefined,
      reason,
    ),
    removedColumns,
    clearedFields,
    patch: clearedFieldsPatch(clearedFields),
    detailParts: [reason],
  }
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return null
  }
}

function isStoredValue(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function revokeFields(
  quarantine: SiteIdentityQuarantine,
  brand: EnrichBrand,
  columns: string[] = quarantine.columns,
): { removedColumns: string[]; newlyCleared: string[]; clearedFields: string[] } {
  const cleared = new Set<string>(quarantine.patch[CLEARED_FIELDS_KEY] ?? [])
  const removedColumns: string[] = []
  const newlyCleared: string[] = []

  // `columns` are runtime-derived link column names, so the patch is read
  // through a string-indexable view rather than a `keyof EnrichPatch`.
  const patchView = quarantine.patch as Record<string, unknown>

  for (const column of columns) {
    // A non-null patch value is a proposal this run made; striking it is a
    // delete. An explicit `null` is a pending CLEAR the links phase already
    // wrote — deleting that key would resurrect the stored value it was meant
    // to remove, so it takes the `_cleared_fields` path instead.
    if (Object.hasOwn(quarantine.patch, column) && patchView[column] !== null) {
      delete patchView[column]
      removedColumns.push(column)
      continue
    }

    // Owner protection belongs to brand-write-policy, the downstream write layer.
    if (patchView[column] === null || isStoredValue((brand as Record<string, unknown>)[column])) {
      if (!cleared.has(column)) newlyCleared.push(column)
      cleared.add(column)
    }
  }

  if (cleared.size > 0) {
    quarantine.patch[CLEARED_FIELDS_KEY] = [...cleared]
  }
  // `newlyCleared` is what THIS phase struck, and is what `changedFields`
  // reports; `clearedFields` is the union the patch must carry, which may
  // include entries an earlier phase put there.
  return { removedColumns, newlyCleared, clearedFields: [...cleared] }
}

function normalisePath(pathname: string): string {
  const path = pathname.toLowerCase().replace(/\/$/, '')
  return path === '/' ? '' : path
}

/**
 * "Does this URL belong to the revoked subject?" — the one ownership rule the
 * image filter and the text revoke both apply. Returns null when the subject
 * URL has no parseable host, which releases everything: the safe direction.
 */
function revokedUrlMatcher(
  subjectUrl: string,
  subjectKind: SiteIdentityQuarantine['subjectKind'],
): ((url: string) => boolean) | null {
  const host = hostOf(subjectUrl)
  if (!host) return null
  const subjectPath = (() => {
    try {
      return normalisePath(new URL(subjectUrl).pathname)
    } catch {
      return ''
    }
  })()
  return (url: string): boolean => {
    if (hostOf(url) !== host) return false
    // A website owns its whole domain; a source-page owns only that page subtree.
    if (subjectKind === 'website' || !subjectPath) return true
    try {
      const candidatePath = normalisePath(new URL(url).pathname)
      return candidatePath === subjectPath || candidatePath.startsWith(subjectPath + '/')
    } catch {
      return false
    }
  }
}

/**
 * DEV-1367. Strikes `description`/`story` that the revoked page supplied.
 *
 * Text needed its own path because the two existing revoke surfaces miss it
 * entirely: `revokeFields` walks `quarantine.columns`, which `buildQuarantine`
 * populates from LINK_FIELDS only, and `filterRevokedImages` handles images. For
 * a brand whose name yields zero Latin tokens the link-identity gate is a no-op,
 * so a stranger's social page can be scraped and — when the official site
 * yielded no text — win the merge. Without this, a high-confidence "not owned"
 * verdict left that copy in `scrapedData` for downstream phases (faq,
 * descriptions), all of which run after this one.
 *
 * Scope is this run's payload, deliberately. Text is NOT added to
 * `_cleared_fields` the way a revoked link column is: `textProvenance` describes
 * only the current run, and nothing anywhere records the source of a description
 * an earlier run wrote. Striking the stored column on this run's verdict would
 * destroy legitimate copy whenever a host that once served good text later
 * serves one bad page.
 *
 * `perSourceText` is left intact — the arbiter has already read it, and it is
 * the evidence backing the verdict being recorded.
 */
function revokeText(
  quarantine: SiteIdentityQuarantine,
  subjectUrl: string,
  subjectKind: SiteIdentityQuarantine['subjectKind'],
): string[] {
  const scraped = quarantine.scrapedData
  if (!scraped) return []
  const isRevoked = revokedUrlMatcher(subjectUrl, subjectKind)
  if (!isRevoked) return []

  const revoked: string[] = []
  for (const field of ['description', 'story'] as const) {
    if (!isStoredValue(scraped[field])) continue
    // Same fallback chain `mergeScrapedData` uses when it records provenance, so
    // a value and its recorded source cannot disagree about which page won.
    // Text with no source at all is released, not struck — matching the
    // unprovenanced-image rule above.
    const sourceUrl = scraped.textProvenance?.[field]?.sourceUrl ?? scraped.textSourceUrl
    if (!sourceUrl || !isRevoked(sourceUrl)) continue

    scraped[field] = null
    if (scraped.textProvenance) {
      delete scraped.textProvenance[field]
      if (Object.keys(scraped.textProvenance).length === 0) delete scraped.textProvenance
    }
    revoked.push(field)
  }

  if (scraped.textSourceUrl && isRevoked(scraped.textSourceUrl)) {
    delete scraped.textSourceUrl
  }

  return revoked
}

function filterRevokedImages(
  linksResult: RevokableImagePayload | null | undefined,
  subjectUrl: string,
  subjectKind: SiteIdentityQuarantine['subjectKind'],
): void {
  if (!linksResult) return
  const sameHost = revokedUrlMatcher(subjectUrl, subjectKind)
  if (!sameHost) return
  const revokedUrls = new Set(
    linksResult.scrapedImageSources
      .filter((image: ScrapedImageSource) => sameHost(image.pageUrl))
      .map((image: ScrapedImageSource) => image.url),
  )
  linksResult.scrapedImageSources = linksResult.scrapedImageSources.filter(
    (image: ScrapedImageSource) => !sameHost(image.pageUrl),
  )
  // Unprovenanced images remain: releasing is the safe direction.
  linksResult.scrapedImageUrls = linksResult.scrapedImageUrls.filter((url: string) => !revokedUrls.has(url))
  if (linksResult.scrapedData?.websiteUrl && sameHost(linksResult.scrapedData.websiteUrl)) {
    linksResult.jsonLdImageUrls = []
  }
}
