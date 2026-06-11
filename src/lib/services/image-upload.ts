import { createServiceClient } from '@/lib/supabase/server'
import type { ImageProcessorConfig } from '@/lib/security/image-processor'

export const ALLOWED_UPLOAD_BUCKETS = ['brand-images', 'claim-proofs'] as const
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
type PrivateUploadImageInput = UploadImageInput & { bucket: 'claim-proofs' }

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

export function diffRemovedImageUrls(
  prev: string[] | null | undefined,
  next: string[] | null | undefined
): string[] {
  const prevUrls = prev ?? []
  const nextUrls = next ?? []

  return prevUrls.filter((url) => !nextUrls.includes(url))
}

export async function deleteBrandImages(urls: string[]): Promise<void> {
  const keys = (urls ?? []).map(storageKeyFromPublicUrl).filter((key): key is string => Boolean(key))

  if (keys.length === 0) {
    return
  }

  try {
    const supabase = createServiceClient()
    const { error } = await supabase.storage.from(BRAND_IMAGES_BUCKET).remove(keys)

    if (error) {
      throw error
    }
  } catch (error) {
    console.error('Failed to delete brand images from storage', error)
  }
}

async function uploadStorageObject(input: UploadImageInput): Promise<string> {
  const supabase = createServiceClient()

  const { data, error: uploadError } = await supabase.storage
    .from(input.bucket)
    .upload(input.path, input.data, {
      contentType: input.contentType,
      upsert: false,
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

export async function uploadPublicImage(input: PublicUploadImageInput): Promise<{ url: string }> {
  await uploadStorageObject(input)
  const supabase = createServiceClient()

  const {
    data: { publicUrl },
  } = supabase.storage.from(input.bucket).getPublicUrl(input.path)

  return {
    url: publicUrl,
  }
}
