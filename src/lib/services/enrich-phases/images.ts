import { downloadAndStoreImages } from '../image-download'
import { buildImageEnrichPatch, hasLinkValue } from '../link-enrichment'
import type { PhaseResult } from '@/lib/types/curation'
import type { CandidateImage } from './candidate-pool'
import { brandTarget, type EnrichmentTarget } from '../enrichment-target'
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

  const { result, durationMs } = await timePhase(async () => {
    const imageStoredUrls = dryRun
      ? imageCandidates.map((candidate) => typeof candidate === 'string' ? candidate : candidate.url)
      : await downloadAndStoreImages(imageCandidates, target ?? brandTarget(brand.id))
    const patch = imageStoredUrls.filter(hasLinkValue).length > 0
      ? imagePatchToDbPatch(buildImageEnrichPatch(normalizeImageBrand(brand), imageStoredUrls))
      : {}

    return patch
  })

  const changedFields = Object.keys(result)

  return {
    phaseResult: buildPhaseResult('images', 'succeeded', changedFields, durationMs),
    patch: result,
  }
}
