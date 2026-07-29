import type { PhaseResult } from '@/lib/types/curation'
import { batchSearchBrandImages } from './scraper/search'
import type { BrandImageSearchOutcome } from './scraper/types'
import {
  buildPhaseResult,
  getDisplayBrandName,
  isProviderFailure,
  timePhase,
  type BatchPhaseContext,
  type SearchPhaseResult,
} from './types'

type ImageSearchPhaseOutput = {
  phaseResult: PhaseResult
  imageSearchResults: Map<string, string[]>
  imageSearchOutcomes: Map<string, BrandImageSearchOutcome>
}

export async function runImageSearchPhase(
  ctx: BatchPhaseContext,
  serpResults?: Map<string, SearchPhaseResult>,
): Promise<ImageSearchPhaseOutput> {
  if (!ctx.phases.includes('images')) {
    return {
      phaseResult: buildPhaseResult('image-search', 'skipped', [], 0, undefined, 'images not requested'),
      imageSearchResults: new Map(),
      imageSearchOutcomes: new Map(),
    }
  }

  if (ctx.chunk.length === 0) {
    return {
      phaseResult: buildPhaseResult('image-search', 'skipped', [], 0, undefined, 'empty batch'),
      imageSearchResults: new Map(),
      imageSearchOutcomes: new Map(),
    }
  }

  const activeSubmissionImageCounts = await loadActiveSubmissionImageCounts(ctx)
  const brandsNeedingImages: typeof ctx.chunk = []
  // Brands we could not search because a provider call failed. Zero results from
  // a dead provider says nothing about the brand, so it must never read as
  // "no images needed".
  const providerFailed = new Set<string>()
  let skippedEnoughImages = 0
  let skippedNoSerp = 0
  for (const brand of ctx.chunk) {
    const hasEnoughImages = ctx.targetType === 'submission'
      ? (activeSubmissionImageCounts.get(brand.id) ?? 0) >= 2
      : !!brand.hero_image_url
    if (hasEnoughImages) {
      skippedEnoughImages++
      continue
    }
    const brandName = getDisplayBrandName(brand)
    const serp = serpResults?.get(brandName)
    if (isProviderFailure(serp?.callStatus)) {
      providerFailed.add(brandName)
      continue
    }
    if (serpResults && serp && serp.urls.length === 0 && serp.snippets.length === 0) {
      skippedNoSerp++
      continue
    }
    brandsNeedingImages.push(brand)
  }

  // Every brand that is not already covered — the denominator for "did the whole
  // phase fail?".
  const brandsWithoutImages = ctx.chunk.length - skippedEnoughImages

  if (skippedEnoughImages > 0) {
    ctx.onProgress?.(
      `  [IMAGES] Skipping image search for ${skippedEnoughImages} brand(s) with enough active images`
    )
  }
  if (skippedNoSerp > 0) {
    ctx.onProgress?.(
      `  [IMAGES] Skipping image search for ${skippedNoSerp} brand(s) with no SERP results`
    )
  }
  if (providerFailed.size > 0) {
    ctx.onProgress?.(
      `  [IMAGES] ${providerFailed.size} brand(s) had a failed search provider call — not counted as "no images needed"`
    )
  }

  if (brandsNeedingImages.length === 0) {
    const allFailed = providerFailed.size > 0 && providerFailed.size === brandsWithoutImages
    return {
      phaseResult: buildPhaseResult(
        'image-search',
        allFailed ? 'failed' : 'skipped',
        [],
        0,
        allFailed ? providerFailureError(providerFailed) : undefined,
        buildDetail(ctx.chunk.length, skippedEnoughImages, skippedNoSerp, providerFailed.size),
      ),
      imageSearchResults: new Map(),
      imageSearchOutcomes: new Map(),
    }
  }

  const { result, durationMs } = await timePhase(async () => {
    const imageSearchOutcomes = await batchSearchBrandImages(
      brandsNeedingImages.map((brand) => ({
        brandName: getDisplayBrandName(brand),
        productType: brand.product_type,
        purchaseWebsite: brand.purchaseWebsite ?? brand.purchase_website,
      })),
      5,
      undefined,
      (input) => {
        const brandName = typeof input === 'string' ? input : input.brandName
        const brand = brandsNeedingImages.find((candidate) => getDisplayBrandName(candidate) === brandName)
        if (!brand) throw new Error(`Missing enrichment target for ${brandName}`)
        return {
          target: { type: ctx.targetType ?? 'brand', id: brand.id },
          ...(ctx.jobId ? { jobId: ctx.jobId } : {}),
          supabase: ctx.supabase,
          dryRun: ctx.dryRun,
          config: { phase: 'image-search' },
        }
      },
    )
    const imageSearchResults = new Map<string, string[]>()
    for (const [brandName, outcome] of imageSearchOutcomes.entries()) {
      imageSearchResults.set(brandName, outcome.rows.map((row) => row.url))
      if (isProviderFailure(outcome.callStatus)) providerFailed.add(brandName)
    }
    const totalImages = [...imageSearchResults.values()].reduce((sum, urls) => sum + urls.length, 0)
    ctx.onProgress?.(
      `  [IMAGES] ${providerFailed.size > 0 ? 'PARTIAL' : 'OK'} — ${totalImages} images across ${imageSearchResults.size} brands${providerFailed.size > 0 ? `; ${providerFailed.size} provider error(s)` : ''}`
    )

    const changedFields: string[] = !ctx.dryRun &&
      [...imageSearchResults.values()].some((urls) => urls.length > 0)
      ? ['image_search_results']
      : []

    return { imageSearchResults, imageSearchOutcomes, changedFields }
  })

  const allFailed = providerFailed.size > 0 && providerFailed.size === brandsWithoutImages

  return {
    phaseResult: buildPhaseResult(
      'image-search',
      allFailed ? 'failed' : 'succeeded',
      result.changedFields,
      durationMs,
      allFailed ? providerFailureError(providerFailed) : undefined,
      buildDetail(ctx.chunk.length, skippedEnoughImages, skippedNoSerp, providerFailed.size),
    ),
    imageSearchResults: result.imageSearchResults,
    imageSearchOutcomes: result.imageSearchOutcomes,
  }
}

// 'all brands have images' is only honest when every brand in the chunk was
// skipped for already having enough images. Anything else reports real counts.
function buildDetail(
  chunkSize: number,
  skippedEnoughImages: number,
  skippedNoSerp: number,
  providerFailedCount: number,
): string | undefined {
  if (skippedEnoughImages === chunkSize) return 'all brands have images'
  const parts: string[] = []
  if (skippedEnoughImages > 0) parts.push(`${skippedEnoughImages} had images`)
  if (skippedNoSerp > 0) parts.push(`${skippedNoSerp} had no SERP results`)
  if (providerFailedCount > 0) parts.push(`${providerFailedCount} provider errors`)
  return parts.length > 0 ? parts.join(', ') : undefined
}

function providerFailureError(providerFailed: Set<string>): string {
  return `Search provider failed for all ${providerFailed.size} brand(s) needing images: ${[...providerFailed].join(', ')}`
}

async function loadActiveSubmissionImageCounts(
  ctx: BatchPhaseContext,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  if (ctx.targetType !== 'submission') return counts

  const submissionIds = ctx.chunk.map((brand) => brand.id)
  const { data, error } = await ctx.supabase
    .from('submission_images')
    .select('submission_id')
    .in('submission_id', submissionIds)
    .eq('status', 'active')

  if (error) {
    ctx.onProgress?.('  [IMAGES] Active image lookup failed; continuing with image search')
    return counts
  }

  for (const image of data ?? []) {
    counts.set(image.submission_id, (counts.get(image.submission_id) ?? 0) + 1)
  }

  return counts
}
