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
    const { durationMs } = await timePhase(async () => null)
    return {
      phaseResult: buildPhaseResult('image-search', 'skipped', [], durationMs, undefined, 'images not requested'),
      imageSearchResults: new Map(),
    }
  }

  if (ctx.chunk.length === 0) {
    const { durationMs } = await timePhase(async () => null)
    return {
      phaseResult: buildPhaseResult('image-search', 'skipped', [], durationMs, undefined, 'empty batch'),
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

      const imgNow = new Date().toISOString()
      for (const id of imageBrandIds) {
        await ctx.supabase.from('brands').update({ images_enriched_at: imgNow } as never).eq('id', id)
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
