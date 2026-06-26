import type { PhaseResult } from '@/lib/types/curation'
import {
  classifyProductTypeBatch,
  triageBrandsBatch,
  type BatchClassificationItem,
  type ClassificationResult,
  type TriageBatchItem,
  type TriageResult,
} from '../product-type-classifier'
import {
  buildPhaseResult,
  getDisplayBrandName,
  timePhase,
  type BatchPhaseContext,
  type EnrichBrand,
  type EnrichPatch,
  type SearchPhaseResult,
} from './types'

const TRIAGE_PHASES = ['detect', 'slugs', 'tags'] as const

export function shouldSkipForNonBrand(triageResult: TriageResult | undefined): boolean {
  return Boolean(
    triageResult?.isNonBrand === true &&
    triageResult.confidence === 'high'
  )
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
    return {
      phaseResult: buildPhaseResult('triage', 'skipped', [], 0, undefined, 'no triage phases requested'),
      triageResults: new Map(),
    }
  }

  if (ctx.chunk.length === 0) {
    return {
      phaseResult: buildPhaseResult('triage', 'skipped', [], 0, undefined, 'empty batch'),
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
  ctx: BatchPhaseContext
): Promise<{
  phaseResult: PhaseResult
  batchClassifications: Map<string, ClassificationResult>
}> {
  const shouldRun = (
    ctx.phases.includes('tags') &&
    !ctx.phases.includes('descriptions') &&
    !ctx.phases.includes('detect') &&
    ctx.chunk.length > 0
  )

  if (!shouldRun) {
    return {
      phaseResult: buildPhaseResult('tags', 'skipped', [], 0, undefined, 'standalone classification not required'),
      batchClassifications: new Map(),
    }
  }

  const { result, durationMs } = await timePhase(async () => {
    const classifyItems: BatchClassificationItem[] = ctx.chunk.map((brand) => ({
      slug: brand.slug,
      name: getDisplayBrandName(brand),
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
