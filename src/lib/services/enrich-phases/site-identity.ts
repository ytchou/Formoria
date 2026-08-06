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

export type SiteIdentityQuarantine = QuarantineGroup & {
  patch: EnrichPatch
  /** Unread; drop once the caller stops populating it. */
  scrapedData?: EnrichScrapedData
  linksResult?: LinksPhaseOutput | null
}

export type SiteIdentityApplication = {
  phaseResult: PhaseResult
  removedColumns: string[]
  clearedFields: string[]
  patch: EnrichPatch
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

function skippedBatch(detail: string): SiteIdentityPhaseOutput {
  return {
    phaseResult: buildPhaseResult('site_identity', 'skipped', [], 0, undefined, detail),
    verdicts: new Map(),
    applications: new Map(),
  }
}

function applyRevocation(
  brand: EnrichBrand,
  quarantine: SiteIdentityQuarantine,
  reason: string,
): SiteIdentityApplication {
  const { removedColumns, newlyCleared, clearedFields } = revokeFields(quarantine, brand)
  filterRevokedImages(quarantine.linksResult, quarantine.subjectUrl, quarantine.subjectKind)
  return {
    phaseResult: buildPhaseResult(
      'site_identity',
      'succeeded',
      [...removedColumns, ...newlyCleared],
      0,
      undefined,
      reason,
    ),
    removedColumns,
    clearedFields,
    patch: clearedFields.length > 0 ? { [CLEARED_FIELDS_KEY]: clearedFields } : {},
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
): { removedColumns: string[]; newlyCleared: string[]; clearedFields: string[] } {
  const cleared = new Set<string>(quarantine.patch[CLEARED_FIELDS_KEY] ?? [])
  const removedColumns: string[] = []
  const newlyCleared: string[] = []

  // `columns` are runtime-derived link column names, so the patch is read
  // through a string-indexable view rather than a `keyof EnrichPatch`.
  const patchView = quarantine.patch as Record<string, unknown>

  for (const column of quarantine.columns) {
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

function filterRevokedImages(
  linksResult: LinksPhaseOutput | null | undefined,
  subjectUrl: string,
  subjectKind: SiteIdentityQuarantine['subjectKind'],
): void {
  if (!linksResult) return
  const host = hostOf(subjectUrl)
  if (!host) return
  const subjectPath = (() => {
    try {
      return normalisePath(new URL(subjectUrl).pathname)
    } catch {
      return ''
    }
  })()
  const sameHost = (url: string): boolean => {
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
  const detailParts = prior?.phaseResult.detail ? prior.phaseResult.detail.split('; ') : []
  if (application.phaseResult.detail) detailParts.push(application.phaseResult.detail)
  const detail = [...new Set(detailParts)].join('; ')
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
    patch: clearedFields.length > 0 ? { [CLEARED_FIELDS_KEY]: clearedFields } : {},
  })
}

export async function runSiteIdentityPhase(
  ctx: BatchPhaseContext & { summary?: Record<string, unknown>; completed?: ReadonlySet<string> },
  quarantinesByBrandId: Map<string, SiteIdentityQuarantine[]> | Record<string, SiteIdentityQuarantine[]>,
): Promise<SiteIdentityPhaseOutput> {
  // Union-keyed, not `Record<string, number>`: adding a third subjectKind
  // without an initializer must be a build failure, otherwise the miss
  // writes `undefined + 1` = NaN, which serialises to null in the audit row.
  const noEvidence: Record<SiteIdentityQuarantine['subjectKind'], number> = {
    website: 0,
    'source-page': 0,
  }
  if (!ctx.phases.includes('site_identity')) return skippedBatch('site_identity phase not requested')
  if (ctx.chunk.length === 0) return skippedBatch('empty batch')

  return auditedCall(
    { provider: 'enrich', operation: 'runSiteIdentityPhase', kind: 'service' },
    async () => {
      const items: SiteIdentityItem[] = []
      const itemByKey = new Map<string, { brand: EnrichBrand; quarantine: SiteIdentityQuarantine }>()
      const verdicts = new Map<string, SiteIdentityVerdict>()
      const applications = new Map<string, SiteIdentityApplication>()
      let escalations = 0

      for (const brand of ctx.chunk) {
        if (ctx.completed?.has(brand.id)) continue
        for (const quarantine of groupsForBrand(quarantinesByBrandId, brand.id)) {
          const evidence = quarantine.evidence
          if (Object.keys(evidence).length === 0) {
            noEvidence[quarantine.subjectKind] += 1
            if (quarantine.unverifiable && quarantine.subjectKind === 'website') {
              mergeApplication(
                applications,
                brand.id,
                applyRevocation(brand, quarantine, 'no-evidence'),
                false,
              )
            }
            continue
          }
          escalations += 1
          const item: SiteIdentityItem = {
            slug: brand.slug,
            brandName: brand.name ?? '',
            productType: brand.product_type ?? undefined,
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

      // Published BEFORE the early return: a chunk where every group had empty
      // evidence is exactly the cohort this counter measures, and the summary
      // write below is unreachable on that path. Without this an operator
      // cannot tell "nothing was quarantined" from "everything was dropped
      // unjudged" — and a downstream gate reading a zero it never saw written
      // would arm on a false reading.
      if (ctx.summary) ctx.summary.siteIdentityNoEvidence = noEvidence

      if (items.length === 0) {
        const hasRevocations = [...applications.values()].some(
          (application) => application.phaseResult.status === 'succeeded',
        )
        return {
          phaseResult: buildPhaseResult(
            'site_identity',
            hasRevocations ? 'succeeded' : 'skipped',
            [],
            0,
            undefined,
            hasRevocations ? undefined : 'no evidence',
          ),
          verdicts,
          applications,
        }
      }
      const outcome = await arbitrateSiteIdentity(items, ctx.jobId)
      const reasons: Record<string, unknown> = {}

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
        : `no parsed verdict (${outcome.calls.attempted} call(s))`
      if (ctx.summary) {
        Object.assign(ctx.summary, {
          siteIdentity: reasons,
          siteIdentityRung1Escalations: escalations,
          // siteIdentityNoEvidence is already published above, on every exit path.
          siteIdentityCalls: outcome.calls,
          siteIdentityProviderFailure: providerFailure,
        })
      }
      return {
        // This phase deliberately never sets providerFailure: releasing is safe and setting it would dilute Gate C.
        phaseResult: buildPhaseResult('site_identity', succeeded ? 'succeeded' : 'skipped', [], 0, undefined, succeeded ? undefined : detail),
        verdicts,
        applications,
      }
    },
    { classify: (result) => result.phaseResult.status === 'succeeded' ? 'succeeded' : 'empty' },
  )
}
