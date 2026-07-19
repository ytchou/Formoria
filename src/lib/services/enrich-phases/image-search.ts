import type { PhaseResult } from '@/lib/types/curation'
import { batchSearchBrandImages, type BrandImageSearchResult } from './scraper/search'
import { insertSearchResult } from '../search-results'
import {
  buildPhaseResult,
  getDisplayBrandName,
  timePhase,
  type BatchPhaseContext,
  type SearchPhaseResult,
} from './types'

export async function runImageSearchPhase(ctx: BatchPhaseContext, serpResults?: Map<string, SearchPhaseResult>): Promise<{
  phaseResult: PhaseResult
  imageSearchResults: Map<string, string[]>
}> {
  if (!ctx.phases.includes('images')) {
    return {
      phaseResult: buildPhaseResult('image-search', 'skipped', [], 0, undefined, 'images not requested'),
      imageSearchResults: new Map(),
    }
  }

  if (ctx.chunk.length === 0) {
    return {
      phaseResult: buildPhaseResult('image-search', 'skipped', [], 0, undefined, 'empty batch'),
      imageSearchResults: new Map(),
    }
  }

  const activeSubmissionImageCounts = await loadActiveSubmissionImageCounts(ctx)
  const brandsNeedingImages: typeof ctx.chunk = []
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
    if (serpResults && serp && serp.urls.length === 0 && serp.snippets.length === 0) {
      skippedNoSerp++
      continue
    }
    brandsNeedingImages.push(brand)
  }

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

  if (brandsNeedingImages.length === 0) {
    return {
      phaseResult: buildPhaseResult('image-search', 'skipped', [], 0, undefined, 'all brands have images'),
      imageSearchResults: new Map(),
    }
  }

  const { result, durationMs } = await timePhase(async () => {
    const imageSearchRows = await batchSearchBrandImages(
      brandsNeedingImages.map((brand) => ({
        brandName: getDisplayBrandName(brand),
        productType: brand.product_type,
        purchaseWebsite: brand.purchaseWebsite ?? brand.purchase_website,
      })),
      5
    )
    const imageSearchResults = new Map<string, string[]>()
    for (const [brandName, rows] of imageSearchRows.entries()) {
      imageSearchResults.set(brandName, rows.map((row) => row.url))
    }
    const totalImages = [...imageSearchResults.values()].reduce((sum, urls) => sum + urls.length, 0)
    ctx.onProgress?.(`  [IMAGES] OK — ${totalImages} images across ${imageSearchResults.size} brands`)

    const changedFields: string[] = []
    if (!ctx.dryRun) {
      const imageBrandIds: string[] = []
      for (const brand of brandsNeedingImages) {
        const brandName = getDisplayBrandName(brand)
        const rows = imageSearchRows.get(brandName)
        if (rows && rows.length > 0) {
          await insertSearchResult(
            { type: ctx.targetType ?? 'brand', id: brand.id },
            'image',
            rows.at(0)?.query ?? `${brandName} 台灣`,
            rows.map((row: BrandImageSearchResult) => row.url),
            [],
            rows.map((row: BrandImageSearchResult) => ({ url: row.url, query: row.query })),
            undefined,
            undefined,
            ctx.jobId,
          )
          imageBrandIds.push(brand.id)
        }
      }

      if (imageBrandIds.length > 0) {
        changedFields.push('image_search_results')
      }
    }

    return { imageSearchResults, changedFields }
  })

  return {
    phaseResult: buildPhaseResult('image-search', 'succeeded', result.changedFields, durationMs),
    imageSearchResults: result.imageSearchResults,
  }
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
