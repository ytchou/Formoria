import { createServiceClient } from '@/lib/supabase/server'

const IMAGE_FETCH_TIMEOUT_MS = 10_000

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
): Promise<string[]> {
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
        const contentType =
          response.headers.get('content-type') ?? 'image/jpeg'
        const ext = getExtFromContentType(contentType)
        const filename = `brands/${brandId}/${crypto.randomUUID()}.${ext}`

        const { error: uploadError } = await supabase.storage
          .from('brand-images')
          .upload(filename, blob, { contentType })

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

  return results
    .filter(
      (r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled'
    )
    .map((r) => r.value)
}
