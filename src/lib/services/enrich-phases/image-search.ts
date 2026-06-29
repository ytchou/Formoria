import type { PhaseResult } from '@/lib/types/curation'
import { batchSearchBrandImages } from './scraper/search'
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

  const brandsNeedingImages: typeof ctx.chunk = []
  let skippedHasImages = 0
  let skippedNoSerp = 0
  for (const brand of ctx.chunk) {
    const hasImages =
      !!brand.hero_image_url ||
      (Array.isArray(brand.product_photos) && brand.product_photos.length > 0)
    if (hasImages) {
      skippedHasImages++
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

  if (skippedHasImages > 0) {
    ctx.onProgress?.(
      `  [IMAGES] Skipping image search for ${skippedHasImages} brand(s) with user-provided images`
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

  const filteredNames = brandsNeedingImages.map(getDisplayBrandName)

  const { result, durationMs } = await timePhase(async () => {
    const imageSearchResults = await batchSearchBrandImages(filteredNames, 5)
    const totalImages = [...imageSearchResults.values()].reduce((sum, urls) => sum + urls.length, 0)
    ctx.onProgress?.(`  [IMAGES] OK — ${totalImages} images across ${imageSearchResults.size} brands`)

    const changedFields: string[] = []
    if (!ctx.dryRun) {
      const imageBrandIds: string[] = []
      for (const brand of brandsNeedingImages) {
        const brandName = getDisplayBrandName(brand)
        const images = imageSearchResults.get(brandName)
        if (images && images.length > 0) {
          await insertSearchResult(brand.id, 'image', `${brandName} 台灣`, images, [])
          imageBrandIds.push(brand.id)
        }
      }

      if (imageBrandIds.length > 0) {
        await ctx.supabase
          .from('brands')
          .update({ images_enriched_at: new Date().toISOString() } as never)
          .in('id', imageBrandIds)
      }

      if (imageBrandIds.length > 0) {
        changedFields.push('images_enriched_at')
      }
    }

    return { imageSearchResults, changedFields }
  })

  return {
    phaseResult: buildPhaseResult('image-search', 'succeeded', result.changedFields, durationMs),
    imageSearchResults: result.imageSearchResults,
  }
}
