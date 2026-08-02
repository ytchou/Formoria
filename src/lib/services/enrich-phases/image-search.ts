import type { PhaseResult } from '@/lib/types/curation'
import { batchSearchBrandImages } from './scraper/search'
import type { BrandImageSearchOutcome, ImageQueryInput } from './scraper/types'
import {
  buildPhaseResult,
  getDisplayBrandName,
  isProviderFailure,
  timePhase,
  type BatchPhaseContext,
  type EnrichBrand,
  type EnrichPatch,
  type SearchPhaseResult,
} from './types'

type ImageSearchPhaseOutput = {
  phaseResult: PhaseResult
  /**
   * Both maps are keyed by TARGET ID, not by display name.
   *
   * This phase now runs *after* the per-brand `clean`/`detect`/`links` work, and
   * that work can rewrite a brand's name (detect's high-confidence rename,
   * `deriveScrapedBrandName`). A name key would therefore no longer be
   * guaranteed to match the key the caller reads with, and a mismatched key in
   * a Map is a silent empty result rather than an error. The target id is the
   * one identifier no phase can change.
   */
  imageSearchResults: Map<string, string[]>
  imageSearchOutcomes: Map<string, BrandImageSearchOutcome>
}

/**
 * Prefers a value this run just discovered over the pre-run brand snapshot —
 * the same convention the descriptions phase uses for its `pendingPatch`.
 */
function preferPatched(
  pendingPatch: EnrichPatch | undefined,
  brandValue: string | null | undefined,
  column: keyof EnrichPatch,
): string | null {
  const patched = pendingPatch?.[column]
  if (typeof patched === 'string' && patched.trim().length > 0) return patched.trim()
  if (typeof brandValue === 'string' && brandValue.trim().length > 0) return brandValue.trim()
  return null
}

export async function runImageSearchPhase(
  ctx: BatchPhaseContext,
  /** Keyed by `getDisplayBrandName`, because the discover phase produced it. */
  serpResults?: Map<string, SearchPhaseResult>,
  /**
   * Patch accumulated by the phases that ran before this one, keyed by target
   * id. The `brand` row is the pre-run snapshot, so a website (or a corrected
   * name) the links phase found in this same run only exists here.
   */
  pendingPatches?: Map<string, EnrichPatch>,
): Promise<ImageSearchPhaseOutput> {
  if (!ctx.phases.includes('images')) {
    return {
      phaseResult: buildPhaseResult('image-search', 'skipped', [], 0, undefined, 'images not requested'),
      imageSearchResults: new Map(),
      imageSearchOutcomes: new Map(),
    }
  }

  if (ctx.chunk.length === 0) {
    return {
      phaseResult: buildPhaseResult('image-search', 'skipped', [], 0, undefined, 'empty batch'),
      imageSearchResults: new Map(),
      imageSearchOutcomes: new Map(),
    }
  }

  const activeSubmissionImageCounts = await loadActiveSubmissionImageCounts(ctx)
  const brandsNeedingImages: typeof ctx.chunk = []
  // Brands we could not search because a provider call failed, held by target
  // id. Zero results from a dead provider says nothing about the brand, so it
  // must never read as "no images needed".
  const providerFailed = new Set<string>()
  // Target id -> display name, so the operator-facing failure message can still
  // name brands while every map stays keyed by id.
  const displayNameById = new Map<string, string>()
  let skippedEnoughImages = 0
  let skippedNoSerp = 0
  for (const brand of ctx.chunk) {
    displayNameById.set(brand.id, getDisplayBrandName(brand))
    // An explicit re-run means "go and look again", so the already-has-images
    // shortcut must not silently skip it — that shortcut is what kept brands
    // with two mediocre images from ever seeing better ones. It still applies
    // on the scheduled path, which never sets overwrite, so a nightly sweep
    // does not re-search the whole pending queue.
    const overwrite = brand.overwrite_enrichment === true
    const hasEnoughImages = !overwrite && (ctx.targetType === 'submission'
      ? (activeSubmissionImageCounts.get(brand.id) ?? 0) >= 2
      : !!brand.hero_image_url)
    if (hasEnoughImages) {
      skippedEnoughImages++
      continue
    }
    const serp = serpResults?.get(getDisplayBrandName(brand))
    if (isProviderFailure(serp?.callStatus)) {
      providerFailed.add(brand.id)
      continue
    }
    if (serpResults && serp && serp.urls.length === 0 && serp.snippets.length === 0) {
      skippedNoSerp++
      continue
    }
    brandsNeedingImages.push(brand)
  }

  // Every brand that is not already covered — the denominator for "did the whole
  // phase fail?".
  const brandsWithoutImages = ctx.chunk.length - skippedEnoughImages

  if (skippedEnoughImages > 0) {
    ctx.onProgress?.(
      `  [IMAGES] Skipping image search for ${skippedEnoughImages} brand(s) with enough active images`
    )
  }
  if (skippedNoSerp > 0) {
    ctx.onProgress?.(
      `  [IMAGES] Skipping image search for ${skippedNoSerp} brand(s) with no SERP results`
    )
  }
  if (providerFailed.size > 0) {
    ctx.onProgress?.(
      `  [IMAGES] ${providerFailed.size} brand(s) had a failed search provider call — not counted as "no images needed"`
    )
  }

  if (brandsNeedingImages.length === 0) {
    const allFailed = providerFailed.size > 0 && providerFailed.size === brandsWithoutImages
    return {
      phaseResult: buildPhaseResult(
        'image-search',
        allFailed ? 'failed' : 'skipped',
        [],
        0,
        allFailed ? providerFailureError(providerFailed, displayNameById) : undefined,
        buildDetail(ctx.chunk.length, skippedEnoughImages, skippedNoSerp, providerFailed.size),
      ),
      imageSearchResults: new Map(),
      imageSearchOutcomes: new Map(),
    }
  }

  // Built once so the query name, the audit resolver and the re-keying below
  // all agree on which brand a provider result belongs to.
  const queries: Array<{ brand: EnrichBrand; input: ImageQueryInput }> =
    brandsNeedingImages.map((brand) => {
      const pendingPatch = pendingPatches?.get(brand.id)
      return {
        brand,
        input: {
          // The phases that just ran can improve the name (detect's
          // high-confidence rename, the scraped page title). Because this phase
          // now runs after them, this run's query gets that name instead of
          // having to wait for the next run.
          brandName:
            preferPatched(pendingPatch, getDisplayBrandName(brand), 'name') ?? '',
          productType: brand.product_type,
          // The brand's domain switches the query builder onto its `site:`
          // branch, which is where the image-quality win lives. The links phase
          // runs before this one, so a freshly submitted brand — which has no
          // stored `purchase_website` — gets its own domain on the first run.
          purchaseWebsite: preferPatched(
            pendingPatch,
            brand.purchase_website ?? brand.purchaseWebsite,
            'purchase_website',
          ),
        },
      }
    })
  const brandByQueryName = new Map(
    queries.map((query) => [query.input.brandName, query.brand]),
  )

  const { result, durationMs } = await timePhase(async () => {
    const rawOutcomes = await batchSearchBrandImages(
      queries.map((query) => query.input),
      5,
      undefined,
      (input) => {
        const brandName = typeof input === 'string' ? input : input.brandName
        const brand = brandByQueryName.get(brandName)
        if (!brand) throw new Error(`Missing enrichment target for ${brandName}`)
        return {
          target: { type: ctx.targetType ?? 'brand', id: brand.id },
          ...(ctx.jobId ? { jobId: ctx.jobId } : {}),
          supabase: ctx.supabase,
          dryRun: ctx.dryRun,
          config: { phase: 'image-search' },
        }
      },
    )
    // `batchSearchBrandImages` keys its result by the query name; re-key to the
    // target id before anything downstream sees it.
    const imageSearchOutcomes = new Map<string, BrandImageSearchOutcome>()
    const imageSearchResults = new Map<string, string[]>()
    for (const { brand, input } of queries) {
      const outcome = rawOutcomes.get(input.brandName)
      if (!outcome) continue
      imageSearchOutcomes.set(brand.id, outcome)
      imageSearchResults.set(brand.id, outcome.rows.map((row) => row.url))
      if (isProviderFailure(outcome.callStatus)) providerFailed.add(brand.id)
    }
    const totalImages = [...imageSearchResults.values()].reduce((sum, urls) => sum + urls.length, 0)
    ctx.onProgress?.(
      `  [IMAGES] ${providerFailed.size > 0 ? 'PARTIAL' : 'OK'} — ${totalImages} images across ${imageSearchResults.size} brands${providerFailed.size > 0 ? `; ${providerFailed.size} provider error(s)` : ''}`
    )

    const changedFields: string[] = !ctx.dryRun &&
      [...imageSearchResults.values()].some((urls) => urls.length > 0)
      ? ['image_search_results']
      : []

    return { imageSearchResults, imageSearchOutcomes, changedFields }
  })

  const allFailed = providerFailed.size > 0 && providerFailed.size === brandsWithoutImages

  return {
    phaseResult: buildPhaseResult(
      'image-search',
      allFailed ? 'failed' : 'succeeded',
      result.changedFields,
      durationMs,
      allFailed ? providerFailureError(providerFailed, displayNameById) : undefined,
      buildDetail(ctx.chunk.length, skippedEnoughImages, skippedNoSerp, providerFailed.size),
    ),
    imageSearchResults: result.imageSearchResults,
    imageSearchOutcomes: result.imageSearchOutcomes,
  }
}

// 'all brands have images' is only honest when every brand in the chunk was
// skipped for already having enough images. Anything else reports real counts.
function buildDetail(
  chunkSize: number,
  skippedEnoughImages: number,
  skippedNoSerp: number,
  providerFailedCount: number,
): string | undefined {
  if (skippedEnoughImages === chunkSize) return 'all brands have images'
  const parts: string[] = []
  if (skippedEnoughImages > 0) parts.push(`${skippedEnoughImages} had images`)
  if (skippedNoSerp > 0) parts.push(`${skippedNoSerp} had no SERP results`)
  if (providerFailedCount > 0) parts.push(`${providerFailedCount} provider errors`)
  return parts.length > 0 ? parts.join(', ') : undefined
}

function providerFailureError(
  providerFailed: Set<string>,
  displayNameById: Map<string, string>,
): string {
  const names = [...providerFailed].map((id) => displayNameById.get(id) ?? id)
  return `Search provider failed for all ${providerFailed.size} brand(s) needing images: ${names.join(', ')}`
}

async function loadActiveSubmissionImageCounts(
  ctx: BatchPhaseContext,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  if (ctx.targetType !== 'submission') return counts

  const submissionIds = ctx.chunk.map((brand) => brand.id)
  const { data, error } = await ctx.supabase
    .from('submission_images')
    .select('submission_id')
    .in('submission_id', submissionIds)
    .eq('status', 'active')

  if (error) {
    ctx.onProgress?.('  [IMAGES] Active image lookup failed; continuing with image search')
    return counts
  }

  for (const image of data ?? []) {
    counts.set(image.submission_id, (counts.get(image.submission_id) ?? 0) + 1)
  }

  return counts
}
