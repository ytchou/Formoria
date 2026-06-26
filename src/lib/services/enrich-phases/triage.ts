import type { PhaseResult } from '@/lib/types/curation'
import {
  classifyProductTypeBatch,
  triageBrandsBatch,
  type BatchClassificationItem,
  type ClassificationResult,
  type TriageBatchItem,
  type TriageResult,
} from '../product-type-classifier'
import { shouldSkipForNonBrand } from '../curation-operations'
import {
  buildPhaseResult,
  timePhase,
  type BatchPhaseContext,
  type EnrichBrand,
  type EnrichPatch,
  type SearchPhaseResult,
} from './types'

const LEGACY_DISPLAY_NAME_KEY = ['display', 'brand', 'name'].join('_')
const TRIAGE_PHASES = ['detect', 'slugs', 'tags'] as const

function displayBrandName(brand: { name?: string | null }): string {
  const legacyName = (brand as Record<string, unknown>)[LEGACY_DISPLAY_NAME_KEY]
  return brand.name ?? (typeof legacyName === 'string' ? legacyName : '')
}

function hasTriagePhases(phases: BatchPhaseContext['phases']): boolean {
  return phases.includes('detect') || phases.includes('slugs') || phases.includes('tags')
}

function buildTriagePatch(
  brand: EnrichBrand,
  triageResult: TriageResult | undefined,
  phases: readonly string[] = TRIAGE_PHASES
): EnrichPatch {
  const patch: EnrichPatch = {}

  if (!triageResult) {
    return patch
  }

  const KEBAB_CASE_RE = /^[a-z0-9]+(-[a-z0-9]+)+$/
  if (
    phases.includes('slugs') &&
    triageResult.slugGenerated &&
    triageResult.slugGenerated !== brand.slug &&
    KEBAB_CASE_RE.test(triageResult.slugGenerated)
  ) {
    patch.slug = triageResult.slugGenerated
  }

  if (phases.includes('tags') && triageResult.productType !== null) {
    patch.product_type = triageResult.productType
  }

  if (phases.includes('tags') && triageResult.valueTags.length > 0) {
    patch.tag_slugs = triageResult.valueTags
  }

  return patch
}

export async function runTriagePhase(
  ctx: BatchPhaseContext,
  searchResults: Map<string, SearchPhaseResult>
): Promise<{
  phaseResult: PhaseResult
  triageResults: Map<string, TriageResult>
}> {
  if (!hasTriagePhases(ctx.phases)) {
    const { durationMs } = await timePhase(async () => null)
    return {
      phaseResult: buildPhaseResult('triage', 'skipped', [], durationMs, undefined, 'no triage phases requested'),
      triageResults: new Map(),
    }
  }

  if (ctx.chunk.length === 0) {
    const { durationMs } = await timePhase(async () => null)
    return {
      phaseResult: buildPhaseResult('triage', 'skipped', [], durationMs, undefined, 'empty batch'),
      triageResults: new Map(),
    }
  }

  const { result, durationMs } = await timePhase(async () => {
    const triageItems: TriageBatchItem[] = ctx.chunk.map((brand, index) => ({
      slug: brand.slug,
      name: ctx.chunkBrandNames[index],
      description: brand.description ?? null,
      website: brand.purchase_website ?? null,
      snippets: searchResults.get(ctx.chunkBrandNames[index])?.snippets ?? [],
    }))
    const triageResults = await triageBrandsBatch(triageItems)
    const nonBrandCount = [...triageResults.values()].filter((triageResult) => triageResult.isNonBrand).length
    console.log(`Triage: ${triageResults.size} brands processed, ${nonBrandCount} non-brands detected`)
    ctx.onProgress?.(`  [TRIAGE] OK — ${triageResults.size} results, ${nonBrandCount} non-brands`)

    return { triageResults, nonBrandCount }
  })

  return {
    phaseResult: buildPhaseResult(
      'triage',
      'succeeded',
      result.nonBrandCount > 0 ? ['status'] : [],
      durationMs
    ),
    triageResults: result.triageResults,
  }
}

export async function runStandaloneClassification(
  ctx: BatchPhaseContext,
  hasTriagePhasesValue: boolean
): Promise<{
  phaseResult: PhaseResult
  batchClassifications: Map<string, ClassificationResult>
}> {
  const shouldRun = (
    ctx.phases.includes('tags') &&
    !ctx.phases.includes('descriptions') &&
    !hasTriagePhasesValue &&
    ctx.chunk.length > 0
  )

  if (!shouldRun) {
    const { durationMs } = await timePhase(async () => null)
    return {
      phaseResult: buildPhaseResult('tags', 'skipped', [], durationMs, undefined, 'standalone classification not required'),
      batchClassifications: new Map(),
    }
  }

  const { result, durationMs } = await timePhase(async () => {
    const classifyItems: BatchClassificationItem[] = ctx.chunk.map((brand) => ({
      slug: brand.slug,
      name: displayBrandName(brand),
      description: brand.description ?? null,
    }))
    const batchClassifications = await classifyProductTypeBatch(classifyItems)
    ctx.onProgress?.(`  [TAGS] OK — ${batchClassifications.size} classifications`)

    return batchClassifications
  })

  return {
    phaseResult: buildPhaseResult(
      'tags',
      'succeeded',
      result.size > 0 ? ['product_type'] : [],
      durationMs
    ),
    batchClassifications: result,
  }
}

export function applyTriageResult(
  triageResult: TriageResult | undefined,
  brand: EnrichBrand,
  phases: readonly string[] = TRIAGE_PHASES
): {
  isNonBrand: boolean
  phaseResult: PhaseResult
  patch: EnrichPatch
} {
  if (shouldSkipForNonBrand(triageResult)) {
    return {
      isNonBrand: true,
      phaseResult: buildPhaseResult(
        'triage',
        'skipped',
        [],
        0,
        undefined,
        triageResult?.nonBrandReason ?? 'non-brand'
      ),
      patch: {},
    }
  }

  const patch = buildTriagePatch(brand, triageResult, phases)
  const changedFields = Object.keys(patch)

  return {
    isNonBrand: false,
    phaseResult: buildPhaseResult(
      'triage',
      triageResult ? 'succeeded' : 'skipped',
      changedFields,
      0,
      undefined,
      triageResult ? undefined : 'no triage result'
    ),
    patch,
  }
}
