import sharp from 'sharp'

import { createServiceClient } from '@/lib/supabase/server'

const IMAGE_FETCH_TIMEOUT_MS = 10_000
const MIN_IMAGE_SIZE_BYTES = 5_120
const MIN_IMAGE_DIMENSION_PX = 400

function getExtFromContentType(contentType: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
  }
  return map[contentType] ?? 'jpg'
}

export async function downloadAndStoreImages(
  urls: string[],
  brandId: string
): Promise<(string | null)[]> {
  if (urls.length === 0) return []

  const supabase = createServiceClient()

  const results = await Promise.allSettled(
    urls.map(async (url) => {
      const controller = new AbortController()
      const timeoutId = setTimeout(
        () => controller.abort(),
        IMAGE_FETCH_TIMEOUT_MS
      )

      try {
        const response = await fetch(url, { signal: controller.signal })
        clearTimeout(timeoutId)

        if (!response.ok) {
          throw new Error(`Failed to fetch image: ${response.status}`)
        }

        const blob = await response.blob()
        if (blob.size < MIN_IMAGE_SIZE_BYTES) {
          throw new Error(`Image too small (${blob.size} bytes), skipping`)
        }

        const buffer = Buffer.from(await blob.arrayBuffer())
        const { width, height } = await sharp(buffer).metadata()
        if (
          !width ||
          !height ||
          Math.max(width, height) < MIN_IMAGE_DIMENSION_PX
        ) {
          throw new Error(
            `Image resolution too low (${width ?? 0}x${height ?? 0}), skipping`
          )
        }

        const contentType =
          response.headers.get('content-type') ?? 'image/jpeg'
        const ext = getExtFromContentType(contentType)
        const filename = `brands/${brandId}/${crypto.randomUUID()}.${ext}`

        const { error: uploadError } = await supabase.storage
          .from('brand-images')
          .upload(filename, buffer, { contentType })

        if (uploadError) {
          throw uploadError
        }

        const {
          data: { publicUrl },
        } = supabase.storage.from('brand-images').getPublicUrl(filename)

        return publicUrl
      } catch (err) {
        clearTimeout(timeoutId)
        console.warn(`Failed to download image ${url}:`, err)
        throw err
      }
    })
  )

  return results.map((r) => (r.status === 'fulfilled' ? r.value : null))
}
