import type { PhaseResult } from '@/lib/types/curation'
import { batchSearchBrandImages } from '../scraper/search'
import { insertSearchResult } from '../search-results'
import {
  buildPhaseResult,
  getDisplayBrandName,
  timePhase,
  type BatchPhaseContext,
} from './types'

export async function runImageSearchPhase(ctx: BatchPhaseContext): Promise<{
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

  const { result, durationMs } = await timePhase(async () => {
    const imageSearchResults = await batchSearchBrandImages(ctx.chunkBrandNames, 5)
    const totalImages = [...imageSearchResults.values()].reduce((sum, urls) => sum + urls.length, 0)
    ctx.onProgress?.(`  [IMAGES] OK — ${totalImages} images across ${imageSearchResults.size} brands`)

    const changedFields: string[] = []
    if (!ctx.dryRun) {
      const imageBrandIds: string[] = []
      for (const brand of ctx.chunk) {
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
