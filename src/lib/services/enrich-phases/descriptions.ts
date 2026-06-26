import { rewriteBrandDescription } from '../description-rewrite'
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
  descriptionRewrite: string | null
}

function hasScrapedText(scrapedData: EnrichScrapedData | null): boolean {
  return Boolean(scrapedData?.description || scrapedData?.story)
}

function changedFieldsForPatch(patch: Record<string, unknown>): string[] {
  const changedFields: string[] = []

  if (patch.description !== undefined) {
    changedFields.push('description')
  }

  if (patch.brand_highlights !== undefined) {
    changedFields.push('brand_highlights')
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

  if (!hasScrapedText(scrapedData) && serpSnippets.length === 0) {
    return {
      phaseResult: buildPhaseResult('descriptions', 'skipped', [], 0, undefined, 'no description data available'),
      patch: {},
      descriptionRewrite: null,
    }
  }

  const { result, durationMs } = await timePhase(async () => {
    const textPatch = scrapedData
      ? buildTextEnrichPatch(brand, scrapedData)
      : {}
    const descriptionRewrite = serpSnippets.length > 0
      ? await rewriteBrandDescription(getDisplayBrandName(brand), brand.description ?? null, serpSnippets)
      : null

    return {
      patch: {
        ...textPatch,
        ...(descriptionRewrite ? { description: descriptionRewrite } : {}),
      },
      descriptionRewrite,
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
