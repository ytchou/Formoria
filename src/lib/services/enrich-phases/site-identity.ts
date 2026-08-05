import { auditedCall } from '@/lib/audit'
import {
  arbitrateSiteIdentity,
  siteIdentityKey,
  type SiteIdentityItem,
  type SiteIdentityVerdict,
} from '../site-identity-arbiter'
import { CLEARED_FIELDS_KEY } from '../brand-write-policy'
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
  scrapedData: EnrichScrapedData
  fieldStates?: Record<string, { source?: string }>
  linksResult?: LinksPhaseOutput | null
}

export type SiteIdentityApplication = {
  phaseResult: PhaseResult
  patch: EnrichPatch
}

export type SiteIdentityPhaseOutput = {
  phaseResult: PhaseResult
  verdicts: Map<string, SiteIdentityVerdict>
  applications: Map<string, SiteIdentityApplication>
}

export function resolveQuarantine(
  verdict: SiteIdentityVerdict | undefined,
  quarantine: QuarantineGroup,
): { revoked: boolean; reason: string } {
  if (!verdict) return { revoked: false, reason: 'provider-failure' }
  if (verdict.confidence === 'high' && verdict.owned === false) {
    return { revoked: true, reason: verdict.reason }
  }
  return {
    revoked: false,
    reason: verdict.confidence === 'medium' || verdict.confidence === 'low'
      ? verdict.confidence
      : 'owned',
  }
}

function skippedBatch(detail: string): SiteIdentityPhaseOutput {
  return {
    phaseResult: buildPhaseResult('site_identity', 'skipped', [], 0, undefined, detail),
    verdicts: new Map(),
    applications: new Map(),
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
): string[] {
  const cleared = new Set<string>(quarantine.patch[CLEARED_FIELDS_KEY] ?? [])
  const revoked: string[] = []

  for (const column of quarantine.columns) {
    if (Object.hasOwn(quarantine.patch, column)) {
      delete (quarantine.patch as Record<string, unknown>)[column]
      revoked.push(column)
      continue
    }

    const fieldState = quarantine.fieldStates?.[column]
    if (fieldState?.source === 'owner') continue
    if (isStoredValue((brand as Record<string, unknown>)[column])) {
      cleared.add(column)
      revoked.push(column)
    }
  }

  if (cleared.size > 0) {
    quarantine.patch[CLEARED_FIELDS_KEY] = [...cleared]
  }
  return revoked
}

function filterRevokedImages(
  linksResult: LinksPhaseOutput | null | undefined,
  subjectUrl: string,
): void {
  if (!linksResult) return
  const host = hostOf(subjectUrl)
  if (!host) return
  const sameHost = (url: string): boolean => hostOf(url) === host
  linksResult.scrapedImageSources = linksResult.scrapedImageSources.filter(
    (image: ScrapedImageSource) => !sameHost(image.pageUrl),
  )
  linksResult.scrapedImageUrls = linksResult.scrapedImageSources.length > 0
    ? linksResult.scrapedImageSources.map((image: ScrapedImageSource) => image.url)
    : linksResult.scrapedImageUrls.filter((url: string) => !sameHost(url))
  if (sameHost(linksResult.scrapedData?.websiteUrl ?? '')) {
    linksResult.jsonLdImageUrls = []
  }
}

function applyVerdict(
  brand: EnrichBrand,
  quarantine: SiteIdentityQuarantine,
  verdict: SiteIdentityVerdict | undefined,
): SiteIdentityApplication {
  const decision = resolveQuarantine(verdict, quarantine)
  const patch = quarantine.patch
  if (!decision.revoked) {
    return {
      phaseResult: buildPhaseResult('site_identity', 'skipped', [], 0, undefined, decision.reason),
      patch: {},
    }
  }

  const revokedColumns = revokeFields(quarantine, brand)
  filterRevokedImages(quarantine.linksResult, quarantine.subjectUrl)
  return {
    phaseResult: buildPhaseResult('site_identity', 'succeeded', revokedColumns, 0, undefined, decision.reason),
    patch,
  }
}

export async function runSiteIdentityPhase(
  ctx: BatchPhaseContext & { summary?: Record<string, unknown>; completed?: ReadonlySet<string> },
  quarantinesByBrandId: Map<string, SiteIdentityQuarantine[]> | Record<string, SiteIdentityQuarantine[]>,
): Promise<SiteIdentityPhaseOutput> {
  if (!ctx.phases.includes('site_identity')) return skippedBatch('site_identity phase not requested')
  if (ctx.chunk.length === 0) return skippedBatch('empty batch')

  return auditedCall(
    { provider: 'enrich', operation: 'runSiteIdentityPhase', kind: 'service' },
    async () => {
      const items: SiteIdentityItem[] = []
      const itemByKey = new Map<string, { brand: EnrichBrand; quarantine: SiteIdentityQuarantine }>()
      let escalations = 0

      for (const brand of ctx.chunk) {
        if (ctx.completed?.has(brand.id)) continue
        for (const quarantine of groupsForBrand(quarantinesByBrandId, brand.id)) {
          const evidence = quarantine.evidence
          if (Object.keys(evidence).length === 0) continue
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

      if (items.length === 0) return skippedBatch('no evidence')
      const outcome = await arbitrateSiteIdentity(items, ctx.jobId)
      const verdicts = new Map<string, SiteIdentityVerdict>()
      const applications = new Map<string, SiteIdentityApplication>()
      const reasons: Record<string, unknown> = {}

      for (const item of items) {
        const key = siteIdentityKey(item.slug, item.subjectUrl)
        const verdict = outcome.results.get(key)
        const input = itemByKey.get(key)
        if (!input) continue
        if (verdict) verdicts.set(input.brand.id, verdict)
        const application = applyVerdict(input.brand, input.quarantine, verdict)
        const prior = applications.get(input.brand.id)
        applications.set(input.brand.id, {
          phaseResult: prior
            ? buildPhaseResult('site_identity', 'succeeded', [...prior.phaseResult.changedFields, ...application.phaseResult.changedFields], 0)
            : application.phaseResult,
          patch: { ...(prior?.patch ?? {}), ...application.patch },
        })
        reasons[key] = {
          verdict: verdict?.owned,
          confidence: verdict?.confidence,
          reason: verdict?.reason,
          releaseCause: application.phaseResult.detail,
          revokedColumns: application.phaseResult.changedFields,
        }
      }

      const succeeded = verdicts.size > 0
      if (ctx.summary) {
        Object.assign(ctx.summary, {
          siteIdentity: reasons,
          siteIdentityRung1Escalations: escalations,
        })
      }
      return {
        phaseResult: buildPhaseResult('site_identity', succeeded ? 'succeeded' : 'skipped', [], 0, undefined, succeeded ? undefined : 'no parsed verdict'),
        verdicts,
        applications,
      }
    },
    { classify: (result) => result.phaseResult.status === 'succeeded' ? 'succeeded' : 'empty' },
  )
}
