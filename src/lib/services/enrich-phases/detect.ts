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

function hasDetectPhases(phases: BatchPhaseContext['phases']): boolean {
  return phases.includes('detect') || phases.includes('slugs') || phases.includes('tags')
}

const SEO_JUNK_KEYWORDS = ['推薦', '必買', '伴手禮', '評價', '優惠', '折扣', '開箱', '比較']

function isValidBrandName(newName: string, oldName: string): boolean {
  if (newName.length > 40) return false
  if (SEO_JUNK_KEYWORDS.some((kw) => newName.includes(kw))) return false
  const oldWords = oldName.split(/[\s\-]+/).filter(Boolean)
  const newWords = newName.split(/[\s\-]+/).filter(Boolean)
  const hasOverlap =
    oldWords.some((w) => newName.includes(w)) || newWords.some((w) => oldName.includes(w))
  return hasOverlap
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

  if (phases.includes('tags') && detectResult.productType !== null) {
    patch.product_type = detectResult.productType
  }

  if (
    detectResult.brandName &&
    detectResult.confidence === 'high' &&
    detectResult.brandName !== brand.name &&
    isValidBrandName(detectResult.brandName, brand.name ?? brand.slug)
  ) {
    patch.name = detectResult.brandName
    if (!patch.slug) {
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
