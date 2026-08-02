import type { PhaseResult } from '@/lib/types/curation'
import {
  classifyProductTypeBatch,
  detectBrandsBatch,
  type BatchClassificationItem,
  type ClassificationResult,
  type DetectBatchItem,
  type DetectResult,
} from '../product-type-classifier'
import { generateSlug } from '../brands'
import { isValidBrandName } from '../brand-cleanup'
import {
  buildPhaseResult,
  getDisplayBrandName,
  timePhase,
  type BatchPhaseContext,
  type EnrichBrand,
  type EnrichPatch,
  type SearchPhaseResult,
} from './types'

const DETECT_PHASES = ['detect', 'slugs', 'tags'] as const

export function shouldSkipForNonBrand(detectResult: DetectResult | undefined): boolean {
  return Boolean(
    detectResult?.isNonBrand === true &&
    detectResult.confidence === 'high'
  )
}

/**
 * `tags` is deliberately NOT a trigger. The category moved to the descriptions
 * phase, so detect no longer produces anything a tags run consumes — a
 * DETAIL-only run was paying for a detect LLM call whose only possible effect
 * was renaming the brand. Mirrored in `curation-operations.ts`; keep both in
 * step.
 */
function hasDetectPhases(phases: BatchPhaseContext['phases']): boolean {
  return phases.includes('detect') || phases.includes('slugs')
}


function buildDetectPatch(
  brand: EnrichBrand,
  detectResult: DetectResult | undefined,
  phases: readonly string[] = DETECT_PHASES
): EnrichPatch {
  const patch: EnrichPatch = {}

  if (!detectResult) {
    return patch
  }

  const KEBAB_CASE_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/
  if (
    phases.includes('slugs') &&
    detectResult.slugGenerated &&
    detectResult.slugGenerated !== brand.slug &&
    KEBAB_CASE_RE.test(detectResult.slugGenerated)
  ) {
    patch.slug = detectResult.slugGenerated
  }

  // No product_type write here on purpose: the category is a reasoning task the
  // descriptions phase owns, decided from the brand's own site text and its
  // classified image alt text. Detect only sees SERP snippets.

  if (
    detectResult.brandName &&
    detectResult.confidence === 'high' &&
    detectResult.brandName !== brand.name &&
    isValidBrandName(detectResult.brandName, brand.name ?? brand.slug)
  ) {
    patch.name = detectResult.brandName
    // DETECT_SYSTEM_PROMPT tells the model to return a null slug rather than
    // transliterate a Han name, and the model obeys — this fallback then did the
    // exact thing the prompt forbids, because `generateSlug` Wade-Giles
    // romanises Han characters (`yuan-hsing-tung-fang-cha-yin-pur-sweets` on a
    // live run). So the fallback only applies to a name we can slug faithfully:
    // one with no Han at all. A Han name with no model slug keeps its existing
    // slug untouched. `generateSlug` itself is unchanged — `submissions.ts`
    // still depends on its current behaviour.
    if (!patch.slug && !/\p{Script=Han}/u.test(detectResult.brandName)) {
      const nameSlug = generateSlug(detectResult.brandName)
      if (nameSlug && nameSlug !== brand.slug && KEBAB_CASE_RE.test(nameSlug)) {
        patch.slug = nameSlug
      }
    }
  }

  return patch
}

export async function runDetectPhase(
  ctx: BatchPhaseContext,
  searchResults: Map<string, SearchPhaseResult>
): Promise<{
  phaseResult: PhaseResult
  detectResults: Map<string, DetectResult>
}> {
  if (!hasDetectPhases(ctx.phases)) {
    return {
      phaseResult: buildPhaseResult('detect', 'skipped', [], 0, undefined, 'no detect phases requested'),
      detectResults: new Map(),
    }
  }

  if (ctx.chunk.length === 0) {
    return {
      phaseResult: buildPhaseResult('detect', 'skipped', [], 0, undefined, 'empty batch'),
      detectResults: new Map(),
    }
  }

  const { result, durationMs } = await timePhase(async () => {
    const detectItems: DetectBatchItem[] = ctx.chunk.map((brand, index) => ({
      slug: brand.slug,
      name: ctx.chunkBrandNames[index],
      description: brand.description ?? null,
      website: brand.purchase_website ?? null,
      snippets: searchResults.get(ctx.chunkBrandNames[index])?.snippets ?? [],
      target: { type: ctx.targetType ?? 'brand', id: brand.id },
    }))
    const detectResults = await detectBrandsBatch(detectItems, ctx.jobId)
    const nonBrandCount = [...detectResults.values()].filter((detectResult) => detectResult.isNonBrand).length
    ctx.onProgress?.(`  [DETECT] OK — ${detectResults.size} results, ${nonBrandCount} non-brands`)

    return { detectResults, nonBrandCount }
  })

  return {
    phaseResult: buildPhaseResult(
      'detect',
      'succeeded',
      result.nonBrandCount > 0 ? ['status'] : [],
      durationMs
    ),
    detectResults: result.detectResults,
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
      target: { type: ctx.targetType ?? 'brand', id: brand.id },
    }))
    const batchClassifications = await classifyProductTypeBatch(classifyItems, ctx.jobId)
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

export function applyDetectResult(
  detectResult: DetectResult | undefined,
  brand: EnrichBrand,
  phases: readonly string[] = DETECT_PHASES
): {
  isNonBrand: boolean
  phaseResult: PhaseResult
  patch: EnrichPatch
} {
  if (shouldSkipForNonBrand(detectResult)) {
    return {
      isNonBrand: true,
      phaseResult: buildPhaseResult(
        'detect',
        'skipped',
        [],
        0,
        undefined,
        detectResult?.nonBrandReason ?? 'non-brand'
      ),
      patch: {},
    }
  }

  const patch = buildDetectPatch(brand, detectResult, phases)
  const changedFields = Object.keys(patch)

  return {
    isNonBrand: false,
    phaseResult: buildPhaseResult(
      'detect',
      detectResult ? 'succeeded' : 'skipped',
      changedFields,
      0,
      undefined,
      detectResult ? undefined : 'no detect result'
    ),
    patch,
  }
}
