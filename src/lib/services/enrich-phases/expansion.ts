import { insertExpansionResult } from '../ai-results'
import { runExpansionResearch } from '../expansion-research'
import { loadPersistedScrapeText } from './descriptions'
import type { PhaseResult } from '@/lib/types/curation'
import type { EnrichScrapedData } from './types'
import {
  buildPhaseResult,
  hasPatchValues,
  timePhase,
  type EnrichBrand,
  type EnrichPhase,
} from './types'

type ExpansionPhaseOptions = {
  brand: EnrichBrand
  phases: EnrichPhase[]
  scrapedData: EnrichScrapedData | null
  serpSnippets: string[]
  overwrite?: boolean
}

type ExpansionPhaseOutput = {
  phaseResult: PhaseResult
  patch: Record<string, unknown>
}

function hasExpansionValues(brand: EnrichBrand): boolean {
  return brand.reputation_summary != null
}

function truncateSiteContent(siteContent: unknown): string | null {
  if (siteContent == null) return null
  const content =
    typeof siteContent === 'string'
      ? siteContent
      : typeof siteContent === 'object'
        ? JSON.stringify(siteContent)
        : String(siteContent)

  return content.length > 4000 ? content.slice(0, 4000) : content
}

function getBrandSiteContent(brand: EnrichBrand): string | null {
  return truncateSiteContent(brand.site_content)
}

function getCategory(brand: EnrichBrand): string | null {
  return brand.product_type ?? null
}

export async function runExpansionPhase({
  brand,
  phases,
  serpSnippets,
  overwrite = false,
}: ExpansionPhaseOptions): Promise<ExpansionPhaseOutput> {
  if (!phases.includes('expansion')) {
    return {
      phaseResult: buildPhaseResult(
        'expansion',
        'skipped',
        [],
        0,
        undefined,
        'expansion phase not requested',
      ),
      patch: {},
    }
  }

  if (!overwrite && hasExpansionValues(brand)) {
    return {
      phaseResult: buildPhaseResult(
        'expansion',
        'skipped',
        [],
        0,
        undefined,
        'expansion fields already populated',
      ),
      patch: {},
    }
  }

  const { result, durationMs } = await timePhase(async () => {
    const persistedScrape = await loadPersistedScrapeText(brand.id)
    const brandSiteContent = getBrandSiteContent(brand)
    const siteContent =
      [brandSiteContent, persistedScrape.siteContent]
        .filter(Boolean)
        .join('\n\n') || null
    const expansionResearch = await runExpansionResearch({
      name: brand.name ?? '',
      description: brand.description ?? null,
      category: getCategory(brand),
      serpSnippets: [...serpSnippets, ...persistedScrape.snippets],
      siteContent,
    })

    if (!expansionResearch) {
      return { patch: {} }
    }

    const patch = {
      ...(expansionResearch.reputationSummary != null
        ? { reputation_summary: expansionResearch.reputationSummary }
        : {}),
    }

    return { patch, rawResponse: expansionResearch }
  })

  if (hasPatchValues(result.patch)) {
    await insertExpansionResult({
      brandId: brand.id,
      rawResponse: result.rawResponse,
    })
  }

  return {
    phaseResult: buildPhaseResult(
      'expansion',
      'succeeded',
      hasPatchValues(result.patch)
        ? ['reputation_summary'].filter((field) => field in result.patch)
        : [],
      durationMs,
    ),
    patch: result.patch,
  }
}
