import { rewriteBrandDescription, type DescriptionRewriteResult } from '../description-rewrite'
import { createServiceClient } from '@/lib/supabase/server'
import type { PhaseResult } from '@/lib/types/curation'
import type { EnrichScrapedData } from './types'
import { buildPhaseResult, getDisplayBrandName, hasPatchValues, timePhase, type EnrichBrand, type EnrichPhase } from './types'

type DescriptionsPhaseOptions = {
  brand: EnrichBrand
  phases: EnrichPhase[]
  scrapedData?: EnrichScrapedData | null
  serpSnippets: string[]
}

type DescriptionsPhaseOutput = {
  phaseResult: PhaseResult
  patch: Record<string, unknown>
  descriptionRewrite: DescriptionRewriteResult | null
}

function changedFieldsForPatch(patch: Record<string, unknown>): string[] {
  const changedFields: string[] = []

  if (patch.description !== undefined) {
    changedFields.push('description')
  }

  if (patch.description_en !== undefined) {
    changedFields.push('description_en')
  }

  if (patch.price_range != null) {
    changedFields.push('price_range')
  }

  if (Array.isArray(patch.product_tags) && patch.product_tags.length > 0) {
    changedFields.push('product_tags')
  }

  if (patch.city != null) {
    changedFields.push('city')
  }

  if (patch.category_attributes != null) {
    changedFields.push('category_attributes')
  }

  if (patch.blurb !== undefined) {
    changedFields.push('blurb')
  }

  if (patch.blurb_en !== undefined) {
    changedFields.push('blurb_en')
  }

  if (patch.founding_year != null) {
    changedFields.push('founding_year')
  }

  if (Array.isArray(patch.product_tags_en) && patch.product_tags_en.length > 0) {
    changedFields.push('product_tags_en')
  }

  return changedFields
}

type PersistedScrapeRow = {
  urls: string[] | null
  snippets: string[] | null
  raw_response: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

export type PersistedScrapeText = {
  snippets: string[]
  siteContent: string | null
}

export async function loadPersistedScrapeText(brandId: string): Promise<PersistedScrapeText> {
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('brand_search_results')
    .select('urls, snippets, raw_response')
    .eq('brand_id', brandId)
    .eq('search_type', 'scrape')
    .order('created_at', { ascending: false })
    .limit(1)

  const row = (data?.[0] ?? null) as PersistedScrapeRow | null
  if (!row) {
    return { snippets: [], siteContent: null }
  }

  const raw = isRecord(row.raw_response) ? row.raw_response : {}
  const description = stringValue(raw.description)
  const story = stringValue(raw.story)
  const jsonLd = raw.jsonLd ?? raw.json_ld ?? null
  const snippets = [
    ...(row.snippets ?? []),
    description,
    story,
  ].filter((text): text is string => Boolean(text))
  const siteContentParts = [
    row.urls?.[0] ? `URL: ${row.urls[0]}` : '',
    description ? `Description: ${description}` : '',
    story ? `Story: ${story}` : '',
    jsonLd ? `JSON-LD: ${JSON.stringify(jsonLd)}` : '',
  ].filter(Boolean)

  return {
    snippets: [...new Set(snippets)],
    siteContent: siteContentParts.length > 0 ? siteContentParts.join('\n') : null,
  }
}

function categoryAttributesPatch(
  brand: EnrichBrand,
  descriptionRewrite: DescriptionRewriteResult
): Record<string, unknown> | null {
  const existing = isRecord(brand.category_attributes) ? brand.category_attributes : {}
  const patch = {
    ...existing,
    ...(descriptionRewrite.whereToBuy ? { where_to_buy: descriptionRewrite.whereToBuy } : {}),
  }

  return Object.keys(patch).length > Object.keys(existing).length ? patch : null
}

export async function runDescriptionsPhase({
  brand,
  phases,
  serpSnippets,
}: DescriptionsPhaseOptions): Promise<DescriptionsPhaseOutput> {
  if (!phases.includes('descriptions')) {
    return {
      phaseResult: buildPhaseResult('descriptions', 'skipped', [], 0, undefined, 'descriptions phase not requested'),
      patch: {},
      descriptionRewrite: null,
    }
  }

  const persistedScrape = await loadPersistedScrapeText(brand.id)
  const effectiveSnippets = [...serpSnippets, ...persistedScrape.snippets]

  if (effectiveSnippets.length === 0 && !brand.description) {
    return {
      phaseResult: buildPhaseResult('descriptions', 'skipped', [], 0, undefined, 'no description data available'),
      patch: {},
      descriptionRewrite: null,
    }
  }

  const { result, durationMs } = await timePhase(async () => {
    const rewriteSnippets = effectiveSnippets.length > 0
      ? effectiveSnippets
      : brand.description ? [brand.description] : []
    const descriptionRewrite = rewriteSnippets.length > 0
      ? await rewriteBrandDescription(getDisplayBrandName(brand), brand.description ?? null, rewriteSnippets)
      : null
    const categoryAttributes = descriptionRewrite
      ? categoryAttributesPatch(brand, descriptionRewrite)
      : null

    let descriptionPatch: Record<string, unknown> = {}
    if (descriptionRewrite) {
      const mergedTags = [...new Set([
        ...descriptionRewrite.productTags,
        ...descriptionRewrite.signatureProducts,
      ])]

      descriptionPatch = {
        ...(descriptionRewrite.description_zh ? { description: descriptionRewrite.description_zh } : {}),
        ...(descriptionRewrite.description_en ? { description_en: descriptionRewrite.description_en } : {}),
        ...(descriptionRewrite.blurb_zh ? { blurb: descriptionRewrite.blurb_zh } : {}),
        ...(descriptionRewrite.blurb_en ? { blurb_en: descriptionRewrite.blurb_en } : {}),
        ...(descriptionRewrite.priceRange != null ? { price_range: descriptionRewrite.priceRange } : {}),
        ...(mergedTags.length > 0 ? { product_tags: mergedTags } : {}),
        ...(descriptionRewrite.productTagsEn.length > 0 ? { product_tags_en: descriptionRewrite.productTagsEn } : {}),
        ...(!brand.city && descriptionRewrite.city ? { city: descriptionRewrite.city } : {}),
        ...(descriptionRewrite.foundingYear != null ? { founding_year: descriptionRewrite.foundingYear } : {}),
        ...(categoryAttributes ? { category_attributes: categoryAttributes } : {}),
      }

      if (mergedTags.length > 0 && descriptionRewrite.productTagsEn.length > 0) {
        const supabase = createServiceClient()
        const tagPairs = mergedTags.slice(0, descriptionRewrite.productTagsEn.length).map((zh, i) => ({
          tag_zh: zh,
          tag_en: descriptionRewrite.productTagsEn[i] ?? zh,
        }))

        await supabase
          .from('product_tag_translations')
          .upsert(tagPairs, { onConflict: 'tag_zh', ignoreDuplicates: true })

        const { data: canonical } = await supabase
          .from('product_tag_translations')
          .select('tag_zh, tag_en')
          .in('tag_zh', mergedTags)

        if (canonical && canonical.length > 0) {
          const tagMap = new Map(canonical.map((t: { tag_zh: string; tag_en: string }) => [t.tag_zh, t.tag_en]))
          descriptionPatch.product_tags_en = mergedTags.map(zh => tagMap.get(zh) ?? zh)
        }
      }
    }

    return {
      patch: descriptionPatch,
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
