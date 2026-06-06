import { createServiceClient } from '@/lib/supabase/server'
import type { ProcessedImage } from '@/lib/security/image-processor'

export const ALLOWED_UPLOAD_BUCKETS = ['brand-images'] as const
export type AllowedUploadBucket = (typeof ALLOWED_UPLOAD_BUCKETS)[number]
const BRAND_IMAGES_BUCKET = ALLOWED_UPLOAD_BUCKETS[0]
const BRAND_IMAGES_PUBLIC_SEGMENT = `/storage/v1/object/public/${BRAND_IMAGES_BUCKET}/`

export interface UploadResult {
  url: string
  width: number
  height: number
}

export function storageKeyFromPublicUrl(url: string): string | null {
  if (!url) {
    return null
  }

  const segmentIndex = url.indexOf(BRAND_IMAGES_PUBLIC_SEGMENT)

  if (segmentIndex === -1) {
    return null
  }

  const key = url.slice(segmentIndex + BRAND_IMAGES_PUBLIC_SEGMENT.length)
  return key || null
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

export async function uploadProcessedImage(
  processed: ProcessedImage,
  path: string,
  bucket: AllowedUploadBucket
): Promise<UploadResult> {
  const supabase = createServiceClient()
  const filename = `${path}/${Date.now()}-${crypto.randomUUID()}.webp`

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(filename, processed.buffer, {
      contentType: 'image/webp',
      upsert: false,
    })

  if (uploadError) {
    throw uploadError
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from(bucket).getPublicUrl(filename)

  return {
    url: publicUrl,
    width: processed.width,
    height: processed.height,
  }
}
