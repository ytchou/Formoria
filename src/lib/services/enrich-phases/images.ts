import type { SupabaseClient } from '@supabase/supabase-js'
import { downloadAndStoreImages } from '../image-download'
import { buildImageEnrichPatch, hasLinkValue } from '../link-enrichment'
import type { Database } from '@/lib/database.types'
import type { PhaseResult } from '@/lib/types/curation'
import { buildPhaseResult, timePhase, type EnrichBrand, type EnrichPhase } from './types'

type BrandImagePhaseOptions = {
  brand: EnrichBrand
  phases: EnrichPhase[]
  imageSearchUrls: string[]
  supabase: SupabaseClient<Database> | null
  dryRun?: boolean
  imageStorageId?: string
}

type BrandImagePhaseOutput = {
  phaseResult: PhaseResult
  patch: Record<string, unknown>
}

type ImagePatch = Partial<{
  hero_image_url: string | null
  product_photos: string[]
}>

function normalizeImageBrand(brand: EnrichBrand): {
  heroImageUrl: string | null
  productPhotos: string[] | null
} {
  return {
    heroImageUrl: brand.heroImageUrl ?? brand.hero_image_url ?? null,
    productPhotos: brand.productPhotos ?? brand.product_photos ?? brand.product_images ?? [],
  }
}

function imagePatchToDbPatch(
  patch: Partial<{ heroImageUrl: string | null; productPhotos: string[] }>
): ImagePatch {
  const dbPatch: ImagePatch = {}

  if (patch.heroImageUrl !== undefined) {
    dbPatch.hero_image_url = patch.heroImageUrl
  }

  if (patch.productPhotos !== undefined) {
    dbPatch.product_photos = patch.productPhotos
  }

  return dbPatch
}

export async function runBrandImagePhase({
  brand,
  phases,
  imageSearchUrls,
  supabase,
  dryRun = false,
  imageStorageId,
}: BrandImagePhaseOptions): Promise<BrandImagePhaseOutput> {
  void supabase

  if (!phases.includes('images')) {
    return {
      phaseResult: buildPhaseResult('images', 'skipped', [], 0, undefined, 'images phase not requested'),
      patch: {},
    }
  }

  if (imageSearchUrls.length === 0) {
    return {
      phaseResult: buildPhaseResult('images', 'skipped', [], 0, undefined, 'no image URLs available'),
      patch: {},
    }
  }

  const { result, durationMs } = await timePhase(async () => {
    const imageStoredUrls = dryRun
      ? imageSearchUrls
      : await downloadAndStoreImages(imageSearchUrls, imageStorageId ?? brand.id)
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
