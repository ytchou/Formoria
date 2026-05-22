import { createServiceClient } from '@/lib/supabase/server'
import type { ProcessedImage } from '@/lib/security/image-processor'

export const ALLOWED_UPLOAD_BUCKETS = ['brand-assets'] as const
export type AllowedUploadBucket = (typeof ALLOWED_UPLOAD_BUCKETS)[number]

export interface UploadResult {
  url: string
  width: number
  height: number
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
