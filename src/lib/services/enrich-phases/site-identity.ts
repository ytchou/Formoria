import { auditedCall } from '@/lib/audit'
import {
  arbitrateSiteIdentity,
  siteIdentityKey,
  type SiteIdentityItem,
  type SiteIdentityVerdict,
} from '../site-identity-arbiter'
import { CLEARED_FIELDS_KEY } from '../brand-write-policy'
import { isLlmProviderFailure } from '../_shared/llm-call-outcome'
import type { ScrapedImageSource } from '@/lib/types/scraper'
import type { PhaseResult } from '@/lib/types/curation'
import {
  buildPhaseResult,
  type BatchPhaseContext,
  type EnrichBrand,
  type EnrichPatch,
} from './types'
import type { EnrichScrapedData } from './types'
import type { QuarantineGroup, LinksPhaseOutput } from './links'
import { linkColumnFor } from '../link-enrichment'

export type SiteIdentityQuarantine = QuarantineGroup & {
  patch: EnrichPatch
  /**
   * The SAME object the caller holds as `state.scrapedData` (see
   * `curation-operations`), not a copy — `revokeText` mutates it in place so the
   * channels, reputation and faq phases, which run after this one, never see
   * text from a page judged not-owned. Do not spread it on the way in.
   */
  scrapedData?: EnrichScrapedData
  linksResult?: LinksPhaseOutput | null
}

type SiteIdentityApplication = {
  phaseResult: PhaseResult
  removedColumns: string[]
  clearedFields: string[]
  patch: EnrichPatch
  detailParts: string[]
}

export type SiteIdentityPhaseOutput = {
  phaseResult: PhaseResult
  verdicts: Map<string, SiteIdentityVerdict>
  applications: Map<string, SiteIdentityApplication>
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

function batchOutput(
  status: PhaseResult['status'],
  detail: string | undefined,
  verdicts: Map<string, SiteIdentityVerdict>,
  applications: Map<string, SiteIdentityApplication>,
): SiteIdentityPhaseOutput {
  return {
    phaseResult: buildPhaseResult('site_identity', status, [], 0, undefined, detail),
    verdicts,
    applications,
  }
}

function clearedFieldsPatch(clearedFields: string[]): EnrichPatch {
  return clearedFields.length > 0 ? { [CLEARED_FIELDS_KEY]: clearedFields } : {}
}

function applyRevocation(
  brand: EnrichBrand,
  quarantine: SiteIdentityQuarantine,
  reason: string,
  options: { columns?: string[]; revokeHostContent?: boolean } = {},
): SiteIdentityApplication {
  const { removedColumns, newlyCleared, clearedFields } = revokeFields(quarantine, brand, options.columns)
  // Images and DEV-1367's text revoke are both whole-host actions justified by a
  // verdict. The `no-evidence` path has no verdict, so it opts out of both.
  // (For text the opt-out is belt-and-braces: empty evidence means no page on
  // the host contributed text, so no `textProvenance` entry can point back at it.)
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

function groupsForBrand(
  source: Map<string, SiteIdentityQuarantine[]> | Record<string, SiteIdentityQuarantine[]>,
  id: string,
): SiteIdentityQuarantine[] {
  return source instanceof Map ? source.get(id) ?? [] : source[id] ?? []
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
 * verdict left that copy in `scrapedData` for the channels, reputation and faq
 * phases, all of which run after this one.
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
  linksResult: LinksPhaseOutput | null | undefined,
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

function applyVerdict(
  brand: EnrichBrand,
  quarantine: SiteIdentityQuarantine,
  verdict: SiteIdentityVerdict | undefined,
): SiteIdentityApplication {
  const decision = resolveQuarantine(verdict)
  if (!decision.revoked) {
    return {
      phaseResult: buildPhaseResult('site_identity', 'skipped', [], 0, undefined, decision.reason),
      removedColumns: [],
      clearedFields: [],
      patch: {},
      detailParts: [decision.reason],
    }
  }

  return applyRevocation(brand, quarantine, decision.reason)
}

function mergeApplication(
  applications: Map<string, SiteIdentityApplication>,
  brandId: string,
  application: SiteIdentityApplication,
  hasVerdict: boolean,
): void {
  const prior = applications.get(brandId)
  const changedFields = prior
    ? [...prior.phaseResult.changedFields, ...application.phaseResult.changedFields]
    : application.phaseResult.changedFields
  const removedColumns = prior
    ? [...new Set([...prior.removedColumns, ...application.removedColumns])]
    : application.removedColumns
  const clearedFields = prior
    ? [...new Set([...prior.clearedFields, ...application.clearedFields])]
    : application.clearedFields
  const detailParts = [...new Set([...(prior?.detailParts ?? []), ...application.detailParts])]
  const detail = detailParts.join('; ')
  applications.set(brandId, {
    phaseResult: buildPhaseResult(
      'site_identity',
      prior?.phaseResult.status === 'succeeded' || application.phaseResult.status === 'succeeded' || hasVerdict
        ? 'succeeded'
        : 'skipped',
      changedFields,
      0,
      undefined,
      detail,
    ),
    removedColumns,
    clearedFields,
    patch: clearedFieldsPatch(clearedFields),
    detailParts,
  })
}

export async function runSiteIdentityPhase(
  ctx: BatchPhaseContext & { summary?: Record<string, unknown>; completed?: ReadonlySet<string> },
  quarantinesByBrandId: Map<string, SiteIdentityQuarantine[]> | Record<string, SiteIdentityQuarantine[]>,
): Promise<SiteIdentityPhaseOutput> {
  if (!ctx.phases.includes('site_identity')) return batchOutput('skipped', 'site_identity phase not requested', new Map(), new Map())
  if (ctx.chunk.length === 0) return batchOutput('skipped', 'empty batch', new Map(), new Map())

  return auditedCall(
    { provider: 'enrich', operation: 'runSiteIdentityPhase', kind: 'service' },
    async () => {
      const items: SiteIdentityItem[] = []
      const itemByKey = new Map<string, { brand: EnrichBrand; quarantine: SiteIdentityQuarantine }>()
      const verdicts = new Map<string, SiteIdentityVerdict>()
      const applications = new Map<string, SiteIdentityApplication>()
      // Union-keyed, not `Record<string, number>`: adding a third subjectKind
      // without an initializer must be a build failure, otherwise the miss
      // writes `undefined + 1` = NaN, which serialises to null in the audit row.
      const noEvidence: Record<SiteIdentityQuarantine['subjectKind'], number> = {
        website: 0,
        'source-page': 0,
      }
      const revokedNoEvidence: Record<SiteIdentityQuarantine['subjectKind'], number> = {
        website: 0,
        'source-page': 0,
      }
      const reasons: Record<string, unknown> = {}
      let escalations = 0

      const publishSummary = (
        calls: { attempted: number; providerFailed: number },
        providerFailure: boolean,
      ): void => {
        if (!ctx.summary) return
        Object.assign(ctx.summary, {
          siteIdentity: reasons,
          siteIdentityNoEvidence: noEvidence,
          siteIdentityRevokedNoEvidence: revokedNoEvidence,
          siteIdentityRung1Escalations: escalations,
          siteIdentityCalls: calls,
          siteIdentityProviderFailure: providerFailure,
        })
      }

      for (const brand of ctx.chunk) {
        if (ctx.completed?.has(brand.id)) continue
        for (const quarantine of groupsForBrand(quarantinesByBrandId, brand.id)) {
          const evidence = quarantine.evidence
          if (Object.keys(evidence).length === 0) {
            noEvidence[quarantine.subjectKind] += 1
            if (quarantine.unverifiable && quarantine.subjectKind === 'website') {
              revokedNoEvidence[quarantine.subjectKind] += 1
              const application = applyRevocation(brand, quarantine, 'no-evidence', {
                columns: quarantine.columns.filter((column) => column === linkColumnFor('purchaseWebsite')),
                revokeHostContent: false,
              })
              mergeApplication(
                applications,
                brand.id,
                application,
                false,
              )
              const key = siteIdentityKey(brand.slug, quarantine.subjectUrl)
              reasons[key] = {
                verdict: undefined,
                confidence: undefined,
                reason: undefined,
                releaseCause: 'no-evidence',
                revokedColumns: application.phaseResult.changedFields,
              }
            }
            continue
          }
          escalations += 1
          const item: SiteIdentityItem = {
            slug: brand.slug,
            brandName: brand.name ?? '',
            categorySlug: brand.category ?? undefined,
            subjectUrl: quarantine.subjectUrl,
            subjectKind: quarantine.subjectKind,
            pageTitle: evidence.title,
            pageDescription: evidence.description,
            pageStory: evidence.story,
            target: { type: ctx.targetType ?? 'brand', id: brand.id },
          }
          items.push(item)
          itemByKey.set(siteIdentityKey(item.slug, item.subjectUrl), { brand, quarantine })
        }
      }

      if (items.length === 0) {
        const hasRevocations = applications.size > 0
        publishSummary({ attempted: 0, providerFailed: 0 }, false)
        return batchOutput(
          hasRevocations ? 'succeeded' : 'skipped',
          hasRevocations ? undefined : 'no evidence',
          verdicts,
          applications,
        )
      }
      // Published BEFORE the arbiter call, as on main: auditedCall rethrows, and the
      // caller's summary object is the live audit row. Losing the tally on an arbiter
      // throw would blind the production gate exactly when the arbiter fails.
      publishSummary({ attempted: 0, providerFailed: 0 }, false)
      const outcome = await arbitrateSiteIdentity(items, ctx.jobId)

      for (const item of items) {
        const key = siteIdentityKey(item.slug, item.subjectUrl)
        const verdict = outcome.results.get(key)
        const input = itemByKey.get(key)
        if (!input) continue
        if (verdict) verdicts.set(input.brand.id, verdict)
        const application = applyVerdict(input.brand, input.quarantine, verdict)
        mergeApplication(applications, input.brand.id, application, Boolean(verdict))
        reasons[key] = {
          verdict: verdict?.owned,
          confidence: verdict?.confidence,
          reason: verdict?.reason,
          releaseCause: application.phaseResult.detail,
          revokedColumns: application.phaseResult.changedFields,
        }
      }

      const succeeded =
        verdicts.size > 0 ||
        [...applications.values()].some(
          (application) => application.phaseResult.status === 'succeeded',
        )
      const providerFailure = isLlmProviderFailure(outcome.calls)
      const detail = providerFailure
        ? `provider failure (${outcome.calls.providerFailed}/${outcome.calls.attempted} calls)`
        : succeeded
          ? undefined
          : `no parsed verdict (${outcome.calls.attempted} call(s))`
      publishSummary(outcome.calls, providerFailure)
      return batchOutput(
        // This phase deliberately never sets providerFailure: releasing is safe and setting it would dilute Gate C.
        succeeded ? 'succeeded' : 'skipped',
        detail,
        verdicts,
        applications,
      )
    },
    { classify: (result) => result.phaseResult.status === 'succeeded' ? 'succeeded' : 'empty' },
  )
}
