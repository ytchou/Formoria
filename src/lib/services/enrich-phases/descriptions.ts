import { rewriteBrandDescription, type DescriptionRewriteResult } from '../description-rewrite'
import { buildTextEnrichPatch } from '../link-enrichment'
import type { PhaseResult } from '@/lib/types/curation'
import type { EnrichScrapedData } from './types'
import { buildPhaseResult, getDisplayBrandName, hasPatchValues, timePhase, type EnrichBrand, type EnrichPhase } from './types'

type DescriptionsPhaseOptions = {
  brand: EnrichBrand
  phases: EnrichPhase[]
  scrapedData: EnrichScrapedData | null
  serpSnippets: string[]
}

type DescriptionsPhaseOutput = {
  phaseResult: PhaseResult
  patch: Record<string, unknown>
  descriptionRewrite: DescriptionRewriteResult | null
}

function hasScrapedText(scrapedData: EnrichScrapedData | null): boolean {
  return Boolean(scrapedData?.description || scrapedData?.story)
}

function changedFieldsForPatch(patch: Record<string, unknown>): string[] {
  const changedFields: string[] = []

  if (patch.description !== undefined) {
    changedFields.push('description')
  }

  if (patch.price_range != null) {
    changedFields.push('price_range')
  }

  if (Array.isArray(patch.product_tags) && patch.product_tags.length > 0) {
    changedFields.push('product_tags')
  }

  return changedFields
}

export async function runDescriptionsPhase({
  brand,
  phases,
  scrapedData,
  serpSnippets,
}: DescriptionsPhaseOptions): Promise<DescriptionsPhaseOutput> {
  if (!phases.includes('descriptions')) {
    return {
      phaseResult: buildPhaseResult('descriptions', 'skipped', [], 0, undefined, 'descriptions phase not requested'),
      patch: {},
      descriptionRewrite: null,
    }
  }

  if (!hasScrapedText(scrapedData) && serpSnippets.length === 0 && !brand.description) {
    return {
      phaseResult: buildPhaseResult('descriptions', 'skipped', [], 0, undefined, 'no description data available'),
      patch: {},
      descriptionRewrite: null,
    }
  }

  const { result, durationMs } = await timePhase(async () => {
    const textEnrichPatch = scrapedData
      ? buildTextEnrichPatch(brand, scrapedData)
      : {}
    const textPatch = textEnrichPatch.description !== undefined
      ? { description: textEnrichPatch.description }
      : {}
    const effectiveSnippets = serpSnippets.length > 0
      ? serpSnippets
      : brand.description ? [brand.description] : []
    const descriptionRewrite = effectiveSnippets.length > 0
      ? await rewriteBrandDescription(getDisplayBrandName(brand), brand.description ?? null, effectiveSnippets)
      : null
    const descriptionPatch = descriptionRewrite
      ? {
          ...(descriptionRewrite.description ? { description: descriptionRewrite.description } : {}),
          ...(descriptionRewrite.priceRange != null ? { price_range: descriptionRewrite.priceRange } : {}),
          ...(descriptionRewrite.productTags.length > 0 ? { product_tags: descriptionRewrite.productTags } : {}),
        }
      : {}

    return {
      patch: {
        ...textPatch,
        ...descriptionPatch,
      },
      descriptionRewrite: descriptionRewrite ?? null,
    }
  })

  return {
    phaseResult: buildPhaseResult(
      'descriptions',
      'succeeded',
      hasPatchValues(result.patch) ? changedFieldsForPatch(result.patch) : [],
      durationMs
    ),
    patch: result.patch,
    descriptionRewrite: result.descriptionRewrite,
  }
}
