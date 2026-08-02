import {
  rewriteBrandDescription,
  type DescriptionAttempt,
  type DescriptionEvidence,
  type DescriptionRewriteResult,
} from '../description-rewrite'
import { normalizeProductTags } from '@/lib/services/product-tags'
import { resolveEnrichedPriceRange } from '@/lib/brands/price-range'
import { createServiceClient } from '@/lib/supabase/server'
import { productTypeNameZh } from '@/lib/taxonomy/ontology'
import type { PhaseResult } from '@/lib/types/curation'
import type { EnrichScrapedData } from './types'
import { brandTarget, targetImageStorage, type EnrichmentTarget } from '../enrichment-target'
import {
  buildPhaseResult,
  getDisplayBrandName,
  hasPatchValues,
  timePhase,
  type EnrichBrand,
  type EnrichPatch,
  type EnrichPhase,
} from './types'

type DescriptionsPhaseOptions = {
  brand: EnrichBrand
  phases: EnrichPhase[]
  scrapedData?: EnrichScrapedData | null
  serpSnippets: string[]
  overwrite?: boolean
  dryRun?: boolean
  target?: EnrichmentTarget
  jobId?: string
  /**
   * Patch accumulated by earlier phases (links in particular). The `brand` row is
   * the pre-run snapshot, so a purchase channel discovered by the links phase in
   * this same run only exists here — reading it makes the listing verdict see the
   * channels the run just found.
   */
  pendingPatch?: EnrichPatch
}

type DescriptionsPhaseOutput = {
  phaseResult: PhaseResult
  patch: Record<string, unknown>
  descriptionRewrite: DescriptionRewriteResult | null
  attempts: DescriptionAttempt[]
}

/** Empty for the purposes of "is there anything here worth clearing?". */
function isEmptyFieldValue(value: unknown): boolean {
  if (value == null) return true
  if (typeof value === 'string') return value.trim() === ''
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === 'object') return Object.keys(value as object).length === 0
  return false
}

/**
 * Fields this run affirmatively determined should be EMPTY.
 *
 * A refresh can add and change a field but has no way to empty one: an omitted
 * key means "no opinion" all the way down to the apply RPC, so a value the
 * model has since judged unqualified survives every future run. This is the
 * explicit verdict that makes a clear possible — see `_cleared_fields` in
 * `apply_brand_refresh_with_protected_location_gate`.
 *
 * The policy is deliberately one field. `reputation_summary`'s prompt contract
 * makes null an affirmative verdict: it returns null when there is no
 * third-party evaluation. A null `city`, `founding_year`, `product_type` or
 * link means "could not determine this run", and clearing those would destroy
 * correct data whenever a SERP call came back thin.
 *
 * Returns nothing when `descriptionRewrite` is null: a phase that did not run,
 * or whose LLM call failed, is silence, not a verdict.
 */
export function resolveClearedFields(
  descriptionRewrite: DescriptionRewriteResult | null,
  brand: EnrichBrand,
  shouldWrite: (existing: unknown) => boolean,
): string[] {
  if (!descriptionRewrite) return []

  const cleared: string[] = []
  if (
    !descriptionRewrite.reputationSummary &&
    shouldWrite(brand.reputation_summary) &&
    !isEmptyFieldValue(brand.reputation_summary)
  ) {
    cleared.push('reputation_summary')
  }

  return cleared
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

  if (patch.product_type != null) {
    changedFields.push('product_type')
  }

  if (patch.city != null) {
    changedFields.push('city')
  }

  if (patch.reputation_summary != null) {
    changedFields.push('reputation_summary')
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

  // A clear is a change: the run output has to report the field it emptied, the
  // same way it reports one it rewrote.
  if (Array.isArray(patch._cleared_fields)) {
    for (const field of patch._cleared_fields) {
      if (typeof field === 'string' && !changedFields.includes(field)) {
        changedFields.push(field)
      }
    }
  }

  return changedFields
}

type PersistedScrapeRow = {
  urls: string[] | null
  snippets: string[] | null
  raw_response: unknown
  call_status?: string | null
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

export async function loadPersistedScrapeText(
  targetOrBrandId: EnrichmentTarget | string,
): Promise<PersistedScrapeText> {
  const supabase = createServiceClient()
  const target = typeof targetOrBrandId === 'string' ? brandTarget(targetOrBrandId) : targetOrBrandId
  const foreignKey = target.type === 'brand' ? 'brand_id' : 'submission_id'
  const { data } = await supabase
    .from('brand_search_results')
    .select('urls, snippets, raw_response, call_status')
    .eq(foreignKey, target.id)
    .eq('search_type', 'scrape')
    .order('created_at', { ascending: false })
    .limit(20)

  const rows = (data ?? []) as PersistedScrapeRow[]
  if (rows.length === 0) {
    return { snippets: [], siteContent: null }
  }

  const snippets: string[] = []
  const siteContentParts: string[] = []
  for (const row of rows) {
    if (row.call_status && !['succeeded', 'empty'].includes(row.call_status)) continue
    const outer = isRecord(row.raw_response) ? row.raw_response : {}
    const raw = isRecord(outer.extracted) ? outer.extracted : outer
    const description = stringValue(raw.description)
    const story = stringValue(raw.story)
    const stockistPageText = stringValue(raw.stockistPageText)
    const jsonLd = raw.jsonLd ?? raw.json_ld ?? null
    snippets.push(...(row.snippets ?? []), ...(description ? [description] : []), ...(story ? [story] : []))
    const pageUrl = row.urls?.at(0) ?? stringValue(raw.pageUrl) ?? stringValue(raw.url)
    siteContentParts.push(
      pageUrl ? `URL: ${pageUrl}` : '',
      description ? `Description: ${description}` : '',
      story ? `Story: ${story}` : '',
      stockistPageText ? `Stockist Page: ${stockistPageText}` : '',
      jsonLd ? `JSON-LD: ${JSON.stringify(jsonLd)}` : '',
    )
  }

  return {
    snippets: [...new Set(snippets.filter((text): text is string => Boolean(text)))],
    siteContent: siteContentParts.filter(Boolean).length > 0 ? siteContentParts.filter(Boolean).join('\n') : null,
  }
}

/** Max alt lines fed to the listing verdict — enough to establish "physical products exist". */
const MAX_IMAGE_ALTS = 8

type ImageAltRow = { alt_zh: string | null; alt_en: string | null }

/**
 * Structural view of the image tables. The table name is only known at runtime
 * (brand_images vs submission_images), which the generated union types cannot
 * narrow — same reason `classify-images.ts` casts its client.
 */
type ImageAltQuery = {
  eq: (column: string, value: string) => ImageAltQuery
  order: (column: string, options: { ascending: boolean }) => ImageAltQuery
  limit: (count: number) => Promise<{ data: ImageAltRow[] | null; error: unknown }>
}
type ImageAltClient = {
  from: (table: string) => { select: (columns: string) => ImageAltQuery }
}

/**
 * Reads the alt text the classify-images phase wrote for this target.
 *
 * This is a new query rather than data passed down: `runClassifyImagesPhase`
 * returns only a phase result and a patch, it does not surface the per-image alt
 * text it wrote, and `curation-operations` never holds it either. Touching
 * classify-images to return it is out of scope, so the descriptions phase reads
 * the rows back. Failure is non-fatal — no alts just means weaker listing evidence.
 */
async function loadClassifiedImageAlts(target: EnrichmentTarget): Promise<string[]> {
  try {
    const supabase = createServiceClient() as unknown as ImageAltClient
    const storage = targetImageStorage(target)
    const { data } = await supabase
      .from(storage.table)
      .select('alt_zh, alt_en')
      .eq(storage.foreignKey, target.id)
      .eq('status', 'active')
      .order('sort_order', { ascending: true })
      .limit(MAX_IMAGE_ALTS)

    return (data ?? [])
      .map((row) => stringValue(row.alt_zh) ?? stringValue(row.alt_en))
      .filter((alt): alt is string => alt !== null)
  } catch (error) {
    console.error(
      `  [DESCRIPTIONS] image alt lookup failed:`,
      error instanceof Error ? error.message : String(error),
    )
    return []
  }
}

/** Prefers a value this run just discovered over the pre-run brand snapshot. */
function preferPatched(
  pendingPatch: EnrichPatch | undefined,
  brandValue: string | null | undefined,
  column: keyof EnrichPatch,
): string | null {
  const patched = pendingPatch?.[column]
  if (typeof patched === 'string' && patched.trim().length > 0) return patched.trim()
  return stringValue(brandValue)
}

function buildDescriptionEvidence(
  brand: EnrichBrand,
  pendingPatch: EnrichPatch | undefined,
  imageAlts: string[],
): DescriptionEvidence {
  return {
    links: {
      purchaseWebsite: preferPatched(pendingPatch, brand.purchase_website, 'purchase_website'),
      socialInstagram: preferPatched(pendingPatch, brand.social_instagram, 'social_instagram'),
      socialThreads: preferPatched(pendingPatch, brand.social_threads, 'social_threads'),
      socialFacebook: preferPatched(pendingPatch, brand.social_facebook, 'social_facebook'),
      purchasePinkoi: preferPatched(pendingPatch, brand.purchase_pinkoi, 'purchase_pinkoi'),
      purchaseShopee: preferPatched(pendingPatch, brand.purchase_shopee, 'purchase_shopee'),
    },
    productCategoryZh: productTypeNameZh(
      preferPatched(pendingPatch, brand.product_type, 'product_type'),
    ),
    imageAlts,
  }
}

export async function runDescriptionsPhase({
  brand,
  phases,
  serpSnippets,
  overwrite = false,
  dryRun = false,
  target,
  jobId,
  pendingPatch,
}: DescriptionsPhaseOptions): Promise<DescriptionsPhaseOutput> {
  if (!phases.includes('descriptions')) {
    return {
      phaseResult: buildPhaseResult('descriptions', 'skipped', [], 0, undefined, 'descriptions phase not requested'),
      patch: {},
      descriptionRewrite: null,
      attempts: [],
    }
  }

  const effectiveTarget = target ?? brandTarget(brand.id)
  const persistedScrape = await loadPersistedScrapeText(effectiveTarget)
  const effectiveSnippets = [...serpSnippets, ...persistedScrape.snippets]

  if (effectiveSnippets.length === 0 && !brand.description) {
    return {
      phaseResult: buildPhaseResult('descriptions', 'skipped', [], 0, undefined, 'no description data available'),
      patch: {},
      descriptionRewrite: null,
      attempts: [],
    }
  }

  const { result, durationMs } = await timePhase(async () => {
    const rewriteSnippets =
      effectiveSnippets.length > 0 ? effectiveSnippets : brand.description ? [brand.description] : []
    const truncatedSiteContent = persistedScrape.siteContent?.slice(0, 4000) ?? null
    const imageAlts = rewriteSnippets.length > 0 ? await loadClassifiedImageAlts(effectiveTarget) : []
    const descriptionRewriteOutput =
      rewriteSnippets.length > 0
        ? await rewriteBrandDescription(
            getDisplayBrandName(brand),
            brand.description ?? null,
            rewriteSnippets,
            truncatedSiteContent,
            {
              target: effectiveTarget,
              ...(jobId ? { jobId } : {}),
            },
            buildDescriptionEvidence(brand, pendingPatch, imageAlts),
          )
        : null

    const descriptionRewrite = descriptionRewriteOutput?.result ?? null
    const attempts = descriptionRewriteOutput?.attempts ?? []

    let descriptionPatch: Record<string, unknown> = {}
    let crossBranchTags: string[] = []
    if (descriptionRewrite) {
      const {
        tags: mergedTags,
        tagsEn: mergedTagsEn,
        crossBranch,
      } = normalizeProductTags(
        descriptionRewrite.productTags,
        descriptionRewrite.productTagsEn,
        brand.product_type ?? undefined,
      )
      crossBranchTags = crossBranch

      const shouldWrite = (existing: unknown) =>
        overwrite ||
        existing == null ||
        (typeof existing === 'string' && existing.trim() === '') ||
        (Array.isArray(existing) && existing.length === 0)

      descriptionPatch = {
        ...(descriptionRewrite.description_zh && shouldWrite(brand.description)
          ? { description: descriptionRewrite.description_zh }
          : {}),
        ...(descriptionRewrite.description_en && shouldWrite(brand.description_en)
          ? { description_en: descriptionRewrite.description_en }
          : {}),
        ...(descriptionRewrite.blurb_zh && shouldWrite(brand.blurb) ? { blurb: descriptionRewrite.blurb_zh } : {}),
        ...(descriptionRewrite.blurb_en && shouldWrite(brand.blurb_en)
          ? { blurb_en: descriptionRewrite.blurb_en }
          : {}),
        // Unlike every other field here, an absent price range is filled rather
        // than skipped: `null` fails the review completeness gate, so a brand the
        // model found no price signal for could never be published. See
        // `resolveEnrichedPriceRange` for why mid-range and how a defaulted tier
        // stays traceable.
        ...(shouldWrite(brand.price_range)
          ? { price_range: resolveEnrichedPriceRange(descriptionRewrite.priceRange) }
          : {}),
        // `product_tags` and `product_tags_en` are index-aligned by contract, so
        // they have to be written as one unit. Gating them on two independent
        // `shouldWrite` checks let one land without the other, which is how the
        // rows with more EN entries than zh entries in DEV-1266 were produced.
        // The zh array is the source of truth, so it owns the gate; a brand that
        // already has zh tags but an empty EN array is repaired by
        // `deriveProductTagsEn` at the write boundary, not by a half-write here.
        ...(mergedTags.length > 0 && shouldWrite(brand.product_tags)
          ? { product_tags: mergedTags, product_tags_en: mergedTagsEn }
          : {}),
        // The category is written whenever the model chose one that differs from
        // the brand's current value — unlike the text fields it is not gated on
        // `shouldWrite`, because this phase is now the authority on it (detect no
        // longer assigns it) and a stale category silently mis-files the brand.
        ...(descriptionRewrite.productType &&
        descriptionRewrite.productType !== brand.product_type
          ? { product_type: descriptionRewrite.productType }
          : {}),
        ...(descriptionRewrite.city && shouldWrite(brand.city) ? { city: descriptionRewrite.city } : {}),
        ...(descriptionRewrite.foundingYear != null && shouldWrite(brand.founding_year)
          ? { founding_year: descriptionRewrite.foundingYear }
          : {}),
        ...(descriptionRewrite.reputationSummary && shouldWrite(brand.reputation_summary)
          ? {
              reputation_summary: {
                text: descriptionRewrite.reputationSummary.text,
                text_en: descriptionRewrite.reputationSummary.textEn,
                sources: descriptionRewrite.reputationSummary.sources,
              },
            }
          : {}),
        ...(descriptionRewrite.mitIndicators && shouldWrite(brand.mit_evidence)
          ? {
              mit_evidence: {
                enrichment_signals: descriptionRewrite.mitIndicators.evidence,
                verified_source: 'enrichment_signal',
              },
            }
          : {}),
      }

      // The complement of the conditional spreads above: every one of them
      // contributes `{}` when it has nothing to say, which the apply RPC reads
      // as "leave the current value alone". `_cleared_fields` is how this phase
      // says "I looked, and this field should now be empty".
      const clearedFields = resolveClearedFields(descriptionRewrite, brand, shouldWrite)
      if (clearedFields.length > 0) {
        descriptionPatch._cleared_fields = clearedFields
      }

      if (!dryRun && Array.isArray(descriptionPatch.product_tags) && Array.isArray(descriptionPatch.product_tags_en)) {
        const supabase = createServiceClient()
        const tagPairs = mergedTags.map((zh, i) => ({
          tag_zh: zh,
          tag_en: mergedTagsEn[i] ?? zh,
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
          descriptionPatch.product_tags_en = mergedTags.map((zh) => tagMap.get(zh) ?? zh)
        }
      }
    }

    return {
      patch: descriptionPatch,
      descriptionRewrite,
      attempts,
      crossBranch: crossBranchTags,
    }
  })

  return {
    phaseResult: buildPhaseResult(
      'descriptions',
      'succeeded',
      hasPatchValues(result.patch) ? changedFieldsForPatch(result.patch) : [],
      durationMs,
    ),
    patch: result.patch,
    descriptionRewrite: result.descriptionRewrite,
    attempts: result.attempts,
  }
}
