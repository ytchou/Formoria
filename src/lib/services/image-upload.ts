import { createServiceClient } from '@/lib/supabase/service'
import { auditedCall } from '@/lib/audit'
import type { ImageProcessorConfig } from '@/lib/security/image-processor'
import { uploadWithRetry } from './storage-retry'
import { storagePathFromImageUrl } from '@/lib/images/image-url'
import { BRAND_IMAGES_KEY_PREFIX } from '@/lib/images/storage-keys'

export const ALLOWED_UPLOAD_BUCKETS = [
  'brand-images',
  'claim-proofs',
  'origin-evidence',
] as const
export type AllowedUploadBucket = (typeof ALLOWED_UPLOAD_BUCKETS)[number]
const BRAND_IMAGES_BUCKET = ALLOWED_UPLOAD_BUCKETS[0]
const BRAND_IMAGES_PUBLIC_SEGMENT = `/storage/v1/object/public/${BRAND_IMAGES_BUCKET}/`
const SUBMISSION_IMAGES_KEY_PREFIX = 'submissions/'
// Curated product images (DEV-1404): `curated-products/<brand>/<product>/<hash>.webp`
// in the same `brand-images` bucket.
export const CURATED_PRODUCT_IMAGES_KEY_PREFIX = 'curated-products/'
// Roster-owned COPIES of exhibitor heroes (DEV-1370), written by
// `scripts/seed-expo-exhibitor-content.ts` into the same `brand-images` bucket
// and referenced by `event_exhibitors.image_storage_path`. Read-only here, like
// `submissions/`: they are never a delete-path target.
const EVENT_EXHIBITOR_IMAGES_KEY_PREFIX = 'event-exhibitors/'
const DELETABLE_IMAGE_KEY_PREFIXES = [BRAND_IMAGES_KEY_PREFIX] as const
const READABLE_IMAGE_KEY_PREFIXES = [
  BRAND_IMAGES_KEY_PREFIX,
  SUBMISSION_IMAGES_KEY_PREFIX,
  CURATED_PRODUCT_IMAGES_KEY_PREFIX,
  EVENT_EXHIBITOR_IMAGES_KEY_PREFIX,
] as const

const CLAIM_PROOF_IMAGE_CONFIG: Partial<ImageProcessorConfig> = {
  maxWidth: 2400,
  maxHeight: 2400,
  quality: 92,
}

function getBrandImagesPublicPrefix(): string {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''}${BRAND_IMAGES_PUBLIC_SEGMENT}`
}

interface UploadImageInput {
  bucket: AllowedUploadBucket
  path: string
  data: Buffer
  contentType: string
}

/**
 * `upsert` is opt-in and only safe for a caller whose path is DERIVED, not
 * random: the curated-product write path (DEV-1465) keys its object on
 * sha256(image_source_url), so overwriting in place is precisely how it avoids
 * orphaning the previous object on every apply. A random-path caller must leave
 * it unset — see uploadStorageObject, where it also gates retry idempotency.
 */
type PublicUploadImageInput = UploadImageInput & {
  bucket: 'brand-images'
  upsert?: boolean
}
type PrivateUploadImageInput = UploadImageInput & {
  bucket: 'claim-proofs' | 'origin-evidence'
}
export type PrivateUploadFileInput = Omit<UploadImageInput, 'bucket'> & {
  bucket: 'claim-proofs' | 'run-logs'
  upsert?: boolean
}

export function getUploadImageProcessingConfig(
  bucket: AllowedUploadBucket
): Partial<ImageProcessorConfig> {
  return bucket === 'claim-proofs' ? CLAIM_PROOF_IMAGE_CONFIG : {}
}

/**
 * DELETE-path key derivation for the BRAND-IMAGE flows: `brands/` only. Its
 * consumers (`deleteBrandImages`, `releaseBrandImageUrls`, the `storage_path`
 * written by `syncOwnerUploadedImages`, `scripts/repair-brand-images.ts`) remove
 * every object they resolve, so anything it fails to recognise is merely left
 * alone — a safe failure.
 *
 * `curated-products/` is NOT here on purpose (DEV-1404). Owner brand-image
 * cleanup would otherwise resolve a curated key and delete a curated product's
 * only object while `curated_products.image_url` still points at it — a
 * deletion the storage sweep cannot flag, because the reference survives.
 * A curated deletion path, when one is needed, gets its own explicitly scoped
 * derivation rather than an entry here. `submissions/` remains read-only.
 */
export function storageKeyFromPublicUrl(url: string): string | null {
  const prefix = getBrandImagesPublicPrefix()
  if (!url || !prefix || !url.startsWith(prefix)) {
    return null
  }

  const key = url.slice(prefix.length)
  if (!DELETABLE_IMAGE_KEY_PREFIXES.some((allowed) => key.startsWith(allowed))) {
    return null
  }

  return key
}

/**
 * READ-path twin, deliberately a separate function rather than a loosened
 * `storageKeyFromPublicUrl`. `brands/` and `submissions/` are both in the
 * `brand-images` bucket, and on a read an unrecognised key is the *unsafe*
 * failure: DEV-1374 (2026-08-07) shipped the vision loader on the delete-path
 * helper, so 23 queued `submission_images` rows — the ones with `storage_path`
 * null and a `.../brand-images/submissions/<id>/x.webp` url — resolved to no
 * key and failed their classify phase on every single run, permanently.
 *
 * The asymmetry is the point: the delete path fails closed, the read path fails
 * open, so they cannot share a prefix list.
 */
export function storageKeyFromPublicUrlForRead(url: string): string | null {
  const prefix = getBrandImagesPublicPrefix()
  if (!url || !prefix || !url.startsWith(prefix)) {
    return null
  }

  const key = url.slice(prefix.length)
  if (!READABLE_IMAGE_KEY_PREFIXES.some((allowed) => key.startsWith(allowed))) {
    return null
  }

  return key
}

/**
 * The explicitly scoped curated-product derivation the comment on
 * `storageKeyFromPublicUrl` promised, gated on `curated-products/` ALONE. It is
 * a third function rather than an entry in either prefix list because both of
 * those are shared by other flows: widening the delete list would let owner
 * brand-image cleanup remove a curated object that `curated_products.image_url`
 * still points at, and `storageKeyFromPublicUrlForRead` also resolves `brands/`
 * and `submissions/`, so driving a delete from it would delete those too.
 *
 * It exists because image REPLACEMENT orphans objects. `upsert: true` on a
 * hash-keyed path only covers re-saving the SAME source URL; editing
 * `image_source_url` changes the hash, writes a new object, and leaks the old
 * one. `curated_products` has no `image_storage_path` column, so the previous
 * key can only be recovered from the stored `image_url`.
 */
export function curatedProductStorageKeyFromPublicUrl(url: string): string | null {
  if (!url) return null

  /*
   * Two accepted forms. `/i/<key>` is what DEV-1551 stores from now on; the
   * legacy public storage URL is still on every row written before the flip,
   * and this function's whole job is finding the PREVIOUS object so it can be
   * cleaned up — dropping the legacy form would leak one object per edit.
   */
  const proxyKey = storagePathFromImageUrl(url)
  if (proxyKey) {
    return proxyKey.startsWith(CURATED_PRODUCT_IMAGES_KEY_PREFIX)
      ? proxyKey
      : null
  }

  const prefix = getBrandImagesPublicPrefix()
  if (!prefix || !url.startsWith(prefix)) {
    return null
  }

  const key = url.slice(prefix.length)
  return key.startsWith(CURATED_PRODUCT_IMAGES_KEY_PREFIX) ? key : null
}

export async function deleteBrandImages(urls: string[]): Promise<void> {
  return auditedCall(
    { provider: 'images', operation: 'deleteBrandImages', kind: 'service' },
    async () => {
  const keys = (urls ?? []).map(storageKeyFromPublicUrl).filter((key): key is string => Boolean(key))

  if (keys.length === 0) {
    return
  }

  const supabase = createServiceClient()
  const { error } = await uploadWithRetry(() =>
    supabase.storage.from(BRAND_IMAGES_BUCKET).remove(keys),
  )

  if (error) {
    throw error
  }
    },
  )
}

export async function deleteStoredImagePaths(paths: string[]): Promise<void> {
  return auditedCall(
    { provider: 'images', operation: 'deleteStoredImagePaths', kind: 'service' },
    async () => {
  const keys = [...new Set(paths)].filter(
    (path) =>
      path.startsWith(BRAND_IMAGES_KEY_PREFIX) ||
      path.startsWith(SUBMISSION_IMAGES_KEY_PREFIX) ||
      path.startsWith(CURATED_PRODUCT_IMAGES_KEY_PREFIX)
  )
  if (keys.length === 0) return

  const supabase = createServiceClient()
  for (let index = 0; index < keys.length; index += 1_000) {
    const { error } = await uploadWithRetry(() =>
      supabase.storage
        .from(BRAND_IMAGES_BUCKET)
        .remove(keys.slice(index, index + 1_000)),
    )
    if (error) throw error
  }
    },
  )
}

async function uploadStorageObject(input: UploadImageInput | PrivateUploadFileInput): Promise<string> {
  const supabase = createServiceClient()
  const upload = () =>
    supabase.storage
      .from(input.bucket)
      .upload(input.path, input.data, {
        cacheControl: '31536000',
        contentType: input.contentType,
        upsert: 'upsert' in input ? input.upsert ?? false : false,
      })

  // Only explicit upserts are safe to retry; create-only uploads use random
  // paths and an ambiguous response could otherwise duplicate an object.
  const { data, error: uploadError } = await uploadWithRetry(upload, {
    idempotent: 'upsert' in input && input.upsert === true,
  })

  if (uploadError) {
    throw uploadError
  }

  return data.path
}

export async function uploadPrivateImage(input: PrivateUploadImageInput): Promise<{ key: string }> {
  return auditedCall(
    { provider: 'images', operation: 'uploadPrivateImage', kind: 'service' },
    async () => {
  const path = await uploadStorageObject(input)

  return { key: `${input.bucket}/${path}` }
    },
  )
}

export async function uploadPrivateFile(input: PrivateUploadFileInput): Promise<{ key: string }> {
  return auditedCall(
    { provider: 'images', operation: 'uploadPrivateFile', kind: 'service' },
    async () => {
  const path = await uploadStorageObject(input)

  return { key: `${input.bucket}/${path}` }
    },
  )
}

/**
 * Uploads to the `brand-images` bucket and returns the BUCKET KEY.
 *
 * DEV-1551 task 12: no public-URL lookup. The bucket is private, so a public
 * URL is a dead link — every caller either stores the key (`storage_path`) or
 * renders it through `imagePathToUrl`. The name is kept because the bucket is
 * still the "public imagery" bucket in the sense that matters here: its objects
 * are published content, as opposed to `claim-proofs` / `origin-evidence`.
 */
export async function uploadPublicImage(
  input: PublicUploadImageInput,
): Promise<{ path: string }> {
  return auditedCall(
    { provider: 'images', operation: 'uploadPublicImage', kind: 'service' },
    async () => {
  const path = await uploadStorageObject(input)

  return { path }
    },
  )
}
