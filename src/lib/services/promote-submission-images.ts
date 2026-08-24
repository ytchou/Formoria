/**
 * DEV-1551 — move an approved brand's imagery from `submissions/` to `brands/`.
 *
 * `approve_submission` (SQL, hand-patched, no source file in this repo) copies
 * `submission_images` rows into `brand_images` and carries `storage_path`
 * across verbatim. The storage OBJECT never moves, so an approved brand keeps a
 * `submissions/` key and the same-origin read proxy refuses it — `submissions/`
 * is pre-moderation content and stays private by prefix. Privacy is really a
 * property of the ROW's status, but the proxy cannot read row status without a
 * per-request database round trip, so the object must move when it becomes
 * public. This module performs that move at the approval boundary.
 *
 * Planning and execution live in the dependency-free engine at
 * `@/lib/images/submission-image-promotion`; this file is only the Supabase
 * wiring for it.
 */
import {
  executePromotions,
  planPromotions,
  SUBMISSION_IMAGES_KEY_PREFIX,
  type PromotionResult,
  type PromotionRow,
  type PromotionStorage,
} from '@/lib/images/submission-image-promotion'
import { createServiceClient } from '@/lib/supabase/service'
import { copyBrandImageObject, statBrandImageObject } from './image-upload'

type ServiceClient = ReturnType<typeof createServiceClient>

const PAGE_SIZE = 1_000

type BrandImageKeyRow = {
  id: string
  brand_id: string | null
  storage_path: string | null
}

/**
 * Supabase-backed implementation of the engine's IO seam. The row update is
 * guarded on the old key so a concurrent writer wins instead of being
 * clobbered, and so a re-run cannot rewrite a row twice.
 */
export function createPromotionStorage(
  supabase: ServiceClient = createServiceClient()
): PromotionStorage {
  return {
    statObject: (key) => statBrandImageObject(key),
    copyObject: (sourceKey, targetKey) => copyBrandImageObject(sourceKey, targetKey),
    setStoragePath: async (rowId, targetKey) => {
      const { error } = await supabase
        .from('brand_images')
        .update({ storage_path: targetKey })
        .eq('id', rowId)
        .like('storage_path', `${SUBMISSION_IMAGES_KEY_PREFIX}%`)

      if (error) {
        throw new Error(`Failed to update brand_images:${rowId}: ${error.message}`)
      }
    },
  }
}

/** Every `brand_images` row for one brand that still carries a submissions key. */
async function fetchSubmissionKeyedBrandImages(
  brandId: string,
  supabase: ServiceClient = createServiceClient()
): Promise<PromotionRow[]> {
  const { data, error } = await supabase
    .from('brand_images')
    .select('id, brand_id, storage_path')
    .eq('brand_id', brandId)
    .like('storage_path', `${SUBMISSION_IMAGES_KEY_PREFIX}%`)
    .order('id', { ascending: true })
    .range(0, PAGE_SIZE - 1)

  if (error) {
    throw new Error(
      `Failed to read brand_images for brand ${brandId}: ${error.message}`
    )
  }

  return ((data ?? []) as BrandImageKeyRow[]).map((record) => ({
    id: String(record.id),
    brandId: record.brand_id,
    storagePath: record.storage_path,
  }))
}

/**
 * Promote one approved brand's imagery. NEVER throws.
 *
 * Approval must not fail because promotion failed: a brand that exists with
 * unservable images is recoverable (a re-run of
 * `scripts/promote-submission-images.ts` fixes it), while a failed approval is
 * not. Every unpromoted key is named in the log so an operator can find it.
 *
 * Returns null when the promotion could not even be attempted.
 */
export async function promoteApprovedBrandImages(
  brandId: string,
  options?: {
    supabase?: ServiceClient
    storage?: PromotionStorage
    /** Injected by tests so this path runs with no Supabase client at all. */
    fetchRows?: (brandId: string) => Promise<PromotionRow[]>
  }
): Promise<PromotionResult | null> {
  try {
    // Built lazily: a caller that injects both seams must not construct a
    // client, and a brand with no submissions-keyed rows must not either.
    const readRows =
      options?.fetchRows ??
      ((id: string) =>
        fetchSubmissionKeyedBrandImages(id, options?.supabase ?? createServiceClient()))

    const rows = await readRows(brandId)
    if (rows.length === 0) {
      return null
    }

    const storage =
      options?.storage ??
      createPromotionStorage(options?.supabase ?? createServiceClient())
    const result = await executePromotions(planPromotions(rows), storage)

    const unpromoted = [
      ...result.conflicts,
      ...result.failures,
      ...result.plan.unresolvable.map((problem) => ({
        sourceKey: problem.storagePath ?? '(null)',
        kind: problem.reason,
        detail: undefined as string | undefined,
      })),
    ]

    if (unpromoted.length > 0) {
      console.error(
        `[promoteApprovedBrandImages] brand ${brandId}: ${unpromoted.length} image(s) still under ${SUBMISSION_IMAGES_KEY_PREFIX} and unservable:`,
        unpromoted
          .map(
            (entry) =>
              `${entry.sourceKey} (${entry.kind}${entry.detail ? `: ${entry.detail}` : ''})`
          )
          .join(', ')
      )
    }

    if (result.copied + result.adopted > 0) {
      console.log(
        `[promoteApprovedBrandImages] brand ${brandId}: promoted ${result.copied + result.adopted} image(s) to brands/`
      )
    }

    return result
  } catch (error) {
    console.error(
      `[promoteApprovedBrandImages] brand ${brandId}: promotion failed entirely; images remain under ${SUBMISSION_IMAGES_KEY_PREFIX}`,
      error instanceof Error ? error.message : error
    )
    return null
  }
}
