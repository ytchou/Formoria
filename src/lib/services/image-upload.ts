import { createServiceClient } from '@/lib/supabase/service'
import { auditedCall } from '@/lib/audit'
import { uploadWithRetry } from './storage-retry'
import {
  BRAND_IMAGES_PUBLIC_URL_SEGMENT,
  storageKeyFromBrandImagesPublicUrl,
  storagePathFromImageUrl,
} from '@/lib/images/image-url'
import {
  BRAND_IMAGES_BUCKET,
  BRAND_IMAGES_KEY_PREFIX,
  BRAND_SUBMISSIONS_BUCKET,
  CURATED_PRODUCT_IMAGES_KEY_PREFIX,
  isBrandOwnedStoragePath,
  isPublicStorageKey,
  partitionImageStoragePaths,
  resolveImageStorageLocation,
} from '@/lib/images/storage-keys'

/**
 * Public upload route allowlist. A private bucket belongs here ONLY if a signed-in
 * user may write to it through `/api/upload`; `run-logs` and `claim-proofs` are
 * server-side-only buckets and are absent on purpose.
 */
export const ALLOWED_UPLOAD_BUCKETS = [
  BRAND_IMAGES_BUCKET,
] as const
export type AllowedUploadBucket = (typeof ALLOWED_UPLOAD_BUCKETS)[number]
/**
 * Aliased from `lib/images/image-url.ts`, which owns the public-URL seam.
 * Services depend on `lib/images`, never the other way round.
 */
const BRAND_IMAGES_PUBLIC_SEGMENT = BRAND_IMAGES_PUBLIC_URL_SEGMENT
// Curated product images (DEV-1404): `curated-products/<brand>/<product>/<hash>.webp`
// in the same `brand-images` bucket. Defined in `lib/images/storage-keys.ts`
// since DEV-1744 (the URL builder needs it too) and re-exported here so the
// existing importers keep their import path.
export { CURATED_PRODUCT_IMAGES_KEY_PREFIX }
const DELETABLE_IMAGE_KEY_PREFIXES = [BRAND_IMAGES_KEY_PREFIX] as const

interface UploadImageInput {
  bucket: string
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
  bucket: typeof BRAND_IMAGES_BUCKET
  upsert?: boolean
}
export type PrivateUploadFileInput = Omit<UploadImageInput, 'bucket'> & {
  bucket: 'run-logs'
  upsert?: boolean
}
export type SubmissionUploadImageInput = Omit<UploadImageInput, 'bucket'>

/**
 * DELETE-path key derivation for the BRAND-IMAGE flows: `brands/` only. Its
 * consumers (`deleteBrandImages`, `releaseBrandImageUrls`, the `storage_path`
 * written by `syncOwnerUploadedImages`; `scripts/repair-brand-images.ts` was a
 * consumer until it was retired in DEV-1318) remove
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
  const key = storageKeyFromBrandImagesPublicUrl(url)
  if (!key) {
    return null
  }

  if (!DELETABLE_IMAGE_KEY_PREFIXES.some((allowed) => key.startsWith(allowed))) {
    return null
  }

  return key
}

/**
 * READ-path twin, deliberately a separate function rather than a loosened
 * `storageKeyFromPublicUrl`. It still recognizes legacy submission URLs from
 * before `submissions/**` moved out of `brand-images`; on a read an
 * unrecognised key is the *unsafe* failure. DEV-1374 (2026-08-07) shipped the
 * vision loader on the delete-path helper, so 23 queued `submission_images`
 * rows with only a legacy URL resolved to no key and failed their classify
 * phase on every run.
 *
 * The asymmetry is the point: the delete path fails closed, the read path fails
 * open, so they cannot share a prefix list.
 */
export function storageKeyFromPublicUrlForRead(url: string): string | null {
  if (!url) {
    return null
  }

  /*
   * Matched on the bucket segment, not on the current project's host. A
   * bucket-relative key is the same object whichever project URL fronts it,
   * and requiring an exact host match made this fail closed for every row
   * whose url names a different project -- which is every row in a database
   * restored from another environment. Staging is a copy of production, so on
   * 2026-08-23 all 634 of its rows resolved to nothing and would have lost
   * their images the moment the bucket went private.
   *
   * Safe because the segment names the bucket explicitly and these urls come
   * from our own columns, never from user input. The delete-path twin above
   * stays host-exact on purpose -- it fails closed.
   */
  const segmentIndex = url.indexOf(BRAND_IMAGES_PUBLIC_SEGMENT)
  if (segmentIndex === -1) {
    return null
  }

  const key = url.slice(segmentIndex + BRAND_IMAGES_PUBLIC_SEGMENT.length)
  if (!key || key.includes('..')) {
    return null
  }

  /*
   * No prefix allow-list on the read path. The bucket segment above already
   * established that this is one of our `brand-images` objects, and a list
   * here only adds a way to be wrong: it omitted `curated-products/` until
   * task 11, and `events/` until the 2026-08-23 staging backfill found a row
   * it could not resolve. Reading a key that turns out not to exist is a 404;
   * failing to resolve a key that does exist loses the image. This function is
   * the fail-open twin by design -- `storageKeyFromPublicUrl` above keeps its
   * strict list because deleting is the direction that must fail closed.
   */
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
  const key = storagePathFromImageUrl(url)
  return key?.startsWith(CURATED_PRODUCT_IMAGES_KEY_PREFIX) ? key : null
}

export async function deleteStoredImagePaths(paths: string[]): Promise<void> {
  return auditedCall(
    { provider: 'images', operation: 'deleteStoredImagePaths', kind: 'service' },
    async () => {
      const partitioned = partitionImageStoragePaths(paths)
      const supabase = createServiceClient()
      for (const bucket of [BRAND_IMAGES_BUCKET, BRAND_SUBMISSIONS_BUCKET] as const) {
        const keys = partitioned[bucket]
        for (let index = 0; index < keys.length; index += 1_000) {
          const { error } = await uploadWithRetry(() =>
            supabase.storage.from(bucket).remove(keys.slice(index, index + 1_000)),
          )
          if (error) throw error
        }
      }
    },
  )
}

/**
 * Verified identity metadata for the routed image object, or null when it does
 * not exist. Missing size or ETag is an error because promotion must not adopt
 * or rewrite a row without proving byte identity.
 */
export async function statStoredImageObject(
  key: string
): Promise<{ size: number; etag: string } | null> {
  return auditedCall(
    { provider: 'images', operation: 'statStoredImageObject', kind: 'service' },
    async () => {
      const location = resolveImageStorageLocation(key)
      if (!location) throw new Error(`Invalid image storage path: ${key}`)
      const supabase = createServiceClient()
      const { data, error } = await uploadWithRetry(() =>
        supabase.storage.from(location.bucket).info(key),
      )

      if (error) {
        if (isMissingStorageObjectError(error)) {
          return null
        }
        throw error
      }

      if (typeof data.size !== 'number' || !data.etag?.trim()) {
        throw new Error(`Storage metadata is unverifiable for ${location.bucket}/${key}`)
      }
      return { size: data.size, etag: data.etag.trim() }
    },
  )
}

function isMissingStorageObjectError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false
  }
  const candidate = error as { status?: unknown; statusCode?: unknown; message?: unknown }
  if (candidate.status === 404 || String(candidate.statusCode) === '404') {
    return true
  }
  return (
    typeof candidate.message === 'string' &&
    /not[ _]?found/i.test(candidate.message)
  )
}

/**
 * Server-side copy from private submissions to public brand imagery. Never
 * overwrites: Storage answers an occupied destination with a 409, which the
 * caller must surface rather than resolve. Nothing here deletes the source.
 */
export async function copySubmissionImageToPublic(
  sourceKey: string,
  targetKey: string
): Promise<void> {
  return auditedCall(
    { provider: 'images', operation: 'copySubmissionImageToPublic', kind: 'service' },
    async () => {
      const source = resolveImageStorageLocation(sourceKey)
      const target = resolveImageStorageLocation(targetKey)
      if (source?.bucket !== BRAND_SUBMISSIONS_BUCKET) {
        throw new Error(`Invalid private submission source: ${sourceKey}`)
      }
      if (
        target?.bucket !== BRAND_IMAGES_BUCKET ||
        !isBrandOwnedStoragePath(targetKey)
      ) {
        throw new Error(`Invalid public image destination: ${targetKey}`)
      }
      // The destination key is DERIVED (brands/<brand_id>/<filename>), so a
      // retried copy cannot duplicate an object under a second random name --
      // the worst case is a 409 on the retry, which the promotion engine
      // records and a re-run resolves by adopting the existing target.
      const supabase = createServiceClient()
      const { error } = await uploadWithRetry(() =>
        supabase.storage
          .from(BRAND_SUBMISSIONS_BUCKET)
          .copy(sourceKey, targetKey, { destinationBucket: BRAND_IMAGES_BUCKET }),
      )

      if (error) {
        throw error
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

export async function uploadPrivateFile(input: PrivateUploadFileInput): Promise<{ key: string }> {
  return auditedCall(
    { provider: 'images', operation: 'uploadPrivateFile', kind: 'service' },
    async () => {
      const path = await uploadStorageObject(input)

      return { key: `${input.bucket}/${path}` }
    },
  )
}

export function validatePublicImageUploadPath(path: string): void {
  if (!isPublicStorageKey(path)) {
    throw new Error(`Invalid public image storage path: ${path}`)
  }
}

function validateSubmissionImageUploadPath(path: string): void {
  if (resolveImageStorageLocation(path)?.bucket !== BRAND_SUBMISSIONS_BUCKET) {
    throw new Error(`Invalid submission image storage path: ${path}`)
  }
}

export async function uploadSubmissionImage(
  input: SubmissionUploadImageInput,
): Promise<{ path: string }> {
  return auditedCall(
    { provider: 'images', operation: 'uploadSubmissionImage', kind: 'service' },
    async () => {
      validateSubmissionImageUploadPath(input.path)
      const path = await uploadStorageObject({
        ...input,
        bucket: BRAND_SUBMISSIONS_BUCKET,
      })
      return { path }
    },
  )
}

/**
 * Uploads to the `brand-images` bucket and returns the BUCKET KEY.
 *
 * Every caller stores the bucket-relative key (`storage_path`) or renders it
 * through `imagePathToUrl`, which owns public URL generation.
 */
export async function uploadPublicImage(
  input: PublicUploadImageInput,
): Promise<{ path: string }> {
  return auditedCall(
    { provider: 'images', operation: 'uploadPublicImage', kind: 'service' },
    async () => {
      validatePublicImageUploadPath(input.path)
      const path = await uploadStorageObject(input)

      return { path }
    },
  )
}
