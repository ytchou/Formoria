import { createServiceClient } from '@/lib/supabase/server'
import type { ImageProcessorConfig } from '@/lib/security/image-processor'
import { uploadWithRetry } from './storage-retry'

export const ALLOWED_UPLOAD_BUCKETS = [
  'brand-images',
  'claim-proofs',
  'origin-evidence',
] as const
export type AllowedUploadBucket = (typeof ALLOWED_UPLOAD_BUCKETS)[number]
const BRAND_IMAGES_BUCKET = ALLOWED_UPLOAD_BUCKETS[0]
const BRAND_IMAGES_PUBLIC_SEGMENT = `/storage/v1/object/public/${BRAND_IMAGES_BUCKET}/`
const BRAND_IMAGES_KEY_PREFIX = 'brands/'
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

type PublicUploadImageInput = UploadImageInput & { bucket: 'brand-images' }
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

export function storageKeyFromPublicUrl(url: string): string | null {
  const prefix = getBrandImagesPublicPrefix()
  if (!url || !prefix || !url.startsWith(prefix)) {
    return null
  }

  const key = url.slice(prefix.length)
  if (!key || !key.startsWith(BRAND_IMAGES_KEY_PREFIX)) {
    return null
  }

  return key
}

/**
 * Public render-endpoint URL for a stored brand image, width-capped so vision calls
 * fetch a small derivative instead of the full-size original (a 1.04 MB jpg comes back
 * as ~38 KB at width 512). Returns the input URL unchanged for external/legacy
 * hotlinks or when the Supabase base URL is not configured.
 *
 * Never persist this URL — the `url` column must stay the canonical object URL that
 * `storageKeyFromPublicUrl` and the site both depend on.
 */
export function brandImageRenderUrl(
  input: { storagePath?: string | null; url: string },
  opts?: { width?: number; quality?: number }
): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!base) return input.url

  const key = input.storagePath?.trim() || storageKeyFromPublicUrl(input.url)
  if (!key) return input.url

  const width = opts?.width ?? 512
  const quality = opts?.quality ?? 70

  return `${base}/storage/v1/render/image/public/${BRAND_IMAGES_BUCKET}/${key}?width=${width}&quality=${quality}`
}

export async function deleteBrandImages(urls: string[]): Promise<void> {
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
}

export async function deleteStoredImagePaths(paths: string[]): Promise<void> {
  const keys = [...new Set(paths)].filter(
    (path) => path.startsWith('brands/') || path.startsWith('submissions/')
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
  const path = await uploadStorageObject(input)

  return { key: `${input.bucket}/${path}` }
}

export async function uploadPrivateFile(input: PrivateUploadFileInput): Promise<{ key: string }> {
  const path = await uploadStorageObject(input)

  return { key: `${input.bucket}/${path}` }
}

export async function uploadPublicImage(input: PublicUploadImageInput): Promise<{ url: string }> {
  await uploadStorageObject(input)
  const supabase = createServiceClient()

  const {
    data: { publicUrl },
  } = await uploadWithRetry(async () =>
    supabase.storage.from(input.bucket).getPublicUrl(input.path),
  )

  return {
    url: publicUrl,
  }
}
