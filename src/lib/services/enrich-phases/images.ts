import { downloadAndStoreImages } from '../image-download'
import { auditedCall } from '@/lib/audit'
import { buildImageEnrichPatch, hasLinkValue } from '../link-enrichment'
import type { PhaseResult } from '@/lib/types/curation'
import type { CandidateImage } from './candidate-pool'
import { brandTarget, type EnrichmentTarget } from '../_shared/enrichment-target'
import { buildPhaseResult, timePhase, type EnrichBrand, type EnrichPhase } from './types'

type BrandImagePhaseOptions = {
  brand: EnrichBrand
  phases: EnrichPhase[]
  imageSearchUrls: string[]
  candidateImages?: CandidateImage[]
  dryRun?: boolean
  target?: EnrichmentTarget
}

type BrandImagePhaseOutput = {
  phaseResult: PhaseResult
  patch: Record<string, unknown>
}

type ImagePatch = Partial<{
  hero_image_url: string | null
}>

function normalizeImageBrand(brand: EnrichBrand): {
  heroImageUrl: string | null
  productPhotos: string[] | null
} {
  return {
    heroImageUrl: brand.heroImageUrl ?? brand.hero_image_url ?? null,
    productPhotos: brand.productPhotos ?? brand.product_images ?? [],
  }
}

function imagePatchToDbPatch(
  patch: Partial<{ heroImageUrl: string | null; productPhotos: string[] }>
): ImagePatch {
  const dbPatch: ImagePatch = {}

  if (patch.heroImageUrl !== undefined) {
    dbPatch.hero_image_url = patch.heroImageUrl
  }

  return dbPatch
}

export async function runBrandImagePhase({
  brand,
  phases,
  imageSearchUrls,
  candidateImages,
  dryRun = false,
  target,
}: BrandImagePhaseOptions): Promise<BrandImagePhaseOutput> {
  if (!phases.includes('images')) {
    return {
      phaseResult: buildPhaseResult('images', 'skipped', [], 0, undefined, 'images phase not requested'),
      patch: {},
    }
  }

  const imageCandidates = candidateImages ?? imageSearchUrls
  if (imageCandidates.length === 0) {
    return {
      phaseResult: buildPhaseResult('images', 'skipped', [], 0, undefined, 'no image URLs available'),
      patch: {},
    }
  }

  return auditedCall(
    { provider: 'enrich', operation: 'runBrandImagePhase', kind: 'service' },
    async () => {
  let downloadFailure: string | null = null

  const { result, durationMs } = await timePhase(async () => {
    /**
     * `downloadAndStoreImages` catches per candidate and returns a null slot, so
     * a bad image costs that image and nothing else. This guard is for the work
     * that happens AROUND the per-candidate loop, which has no such protection —
     * two live runs were lost to it: an oversized response header escaping as an
     * undici HeadersOverflowError, and the existing-candidate lookup exceeding
     * PostgREST's URI limit and throwing a raw Supabase object.
     *
     * Both root causes are fixed. The guard stays because the invariant is worth
     * enforcing independently of any particular bug: every later phase copes
     * with zero images, and none of them cope with an exception.
     */
    const imageStoredUrls = dryRun
      ? imageCandidates.map((candidate) => typeof candidate === 'string' ? candidate : candidate.url)
      : await downloadAndStoreImages(imageCandidates, target ?? brandTarget(brand.id)).catch(
          (error: unknown) => {
            downloadFailure = error instanceof Error ? error.message : JSON.stringify(error)
            console.warn(`  [IMAGES] ${brand.slug}: download batch failed — ${downloadFailure}`)
            return [] as (string | null)[]
          }
        )
    // Automated downloads are stored as candidates. Updating the compatibility
    // hero cache here would publish an unclassified URL before the classifier
    // explicitly keeps it; the classify phase owns that projection now.
    const patch = dryRun && imageStoredUrls.filter(hasLinkValue).length > 0
      ? imagePatchToDbPatch(buildImageEnrichPatch(normalizeImageBrand(brand), imageStoredUrls))
      : {}

    return patch
  })

  const changedFields = Object.keys(result)

  // Surfaced as a phase detail rather than swallowed: the brand survives, but a
  // run that quietly produced nothing would be indistinguishable from a brand
  // that genuinely had no candidates.
  if (downloadFailure) {
    return {
      phaseResult: buildPhaseResult(
        'images',
        'failed',
        changedFields,
        durationMs,
        undefined,
        `image download batch failed: ${downloadFailure}`
      ),
      patch: result,
    }
  }

  return {
    phaseResult: buildPhaseResult('images', 'succeeded', changedFields, durationMs),
    patch: result,
  }
    },
    {
      classify: (result) =>
        result.phaseResult.status === 'failed' ? 'failed' : 'succeeded',
    },
  )
}
