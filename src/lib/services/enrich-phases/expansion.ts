import { insertExpansionResult } from '../ai-results'
import { runExpansionResearch } from '../expansion-research'
import { loadPersistedScrapeText } from './descriptions'
import { buildEnrichmentConfig } from '@/lib/constants/enrichment-config'
import { EXPANSION_SYSTEM_PROMPT } from '@/lib/prompts'
import { localizeToTW } from '../taiwan-localization'
import type { PhaseResult } from '@/lib/types/curation'
import type { EnrichScrapedData } from './types'
import { brandTarget, type EnrichmentTarget } from '../enrichment-target'
import {
  buildPhaseResult,
  hasPatchValues,
  timePhase,
  type EnrichBrand,
  type EnrichPhase,
} from './types'

const EXPANSION_CONFIG_PARAMS = {
  model: 'deepseek-v4-flash',
  maxTokens: 1200,
  temperature: 0.1,
  snippetLimit: 10,
  siteContentLimit: 4000,
}

type ExpansionPhaseOptions = {
  brand: EnrichBrand
  phases: EnrichPhase[]
  scrapedData: EnrichScrapedData | null
  serpSnippets: string[]
  overwrite?: boolean
  reputationAlreadySet?: boolean
  target?: EnrichmentTarget
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
  reputationAlreadySet = false,
  target,
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

  if (reputationAlreadySet) {
    return {
      phaseResult: buildPhaseResult(
        'expansion',
        'skipped',
        [],
        0,
        undefined,
        'reputation_summary set by descriptions phase',
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
    const auditTarget = target ?? brandTarget(brand.id)
    const persistedScrape = await loadPersistedScrapeText(auditTarget)
    const brandSiteContent = getBrandSiteContent(brand)
    const siteContent =
      [brandSiteContent, persistedScrape.siteContent]
        .filter(Boolean)
        .join('\n\n') || null
    const expansionInput = {
      name: brand.name ?? '',
      description: brand.description ?? null,
      category: getCategory(brand),
      serpSnippets: [...serpSnippets, ...persistedScrape.snippets],
      siteContent,
    }
    const expansionResearch = await runExpansionResearch(expansionInput)

    if (!expansionResearch) {
      return { patch: {} }
    }

    const patch = {
      ...(expansionResearch.reputationSummary != null
        ? {
            reputation_summary: {
              ...expansionResearch.reputationSummary,
              text: localizeToTW(expansionResearch.reputationSummary.text).text,
            },
          }
        : {}),
    }

    return { patch, rawResponse: expansionResearch, input: expansionInput, latencyMs: expansionResearch.latencyMs }
  })

  if (hasPatchValues(result.patch)) {
    await insertExpansionResult({
      brandId: brand.id,
      target: target ?? brandTarget(brand.id),
      rawResponse: result.rawResponse,
      input: result.input,
      config: buildEnrichmentConfig('expansion', EXPANSION_SYSTEM_PROMPT, EXPANSION_CONFIG_PARAMS as Record<string, unknown>),
      latencyMs: result.latencyMs,
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
