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

  const brandsNeedingImages: typeof ctx.chunk = []
  let skippedHasImages = 0
  let skippedNoSerp = 0
  for (const brand of ctx.chunk) {
    const hasImages = !!brand.hero_image_url
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
            rows.map((row: BrandImageSearchResult) => ({ url: row.url, query: row.query }))
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
