import sharp from 'sharp'
import { auditedCall } from '@/lib/audit'
import { uploadWithRetry } from '../storage-retry'

// Content types accepted for favicon images. .ico is explicitly excluded —
// it is a container format that sharp cannot reliably decode, and modern
// sites serve their touch icons as PNG/SVG.
const ACCEPTED_FAVICON_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
}

const FAVICON_FETCH_TIMEOUT_MS = 10_000
const MIN_FAVICON_SHORT_EDGE_PX = 32

/** Returns true when the content-type header names an accepted favicon format. */
export function isAcceptedFaviconContentType(contentType: string): boolean {
  const base = contentType.split(';')[0].trim().toLowerCase()
  return base in ACCEPTED_FAVICON_TYPES
}

/** Maps a content-type to a file extension, or null if unrecognised. */
export function faviconExtFromContentType(contentType: string): string | null {
  const base = contentType.split(';')[0].trim().toLowerCase()
  return ACCEPTED_FAVICON_TYPES[base] ?? null
}

/**
 * Dimension gate. SVGs are vector and have no meaningful pixel dimensions,
 * so they pass unconditionally. Raster formats must have a short edge of at
 * least {@link MIN_FAVICON_SHORT_EDGE_PX}.
 */
export function isValidFaviconDimensions(
  width: number,
  height: number,
  format: string,
): boolean {
  if (format === 'svg') return true
  return Math.min(width, height) >= MIN_FAVICON_SHORT_EDGE_PX
}

/**
 * Picks the best logo-class image from a set of brand_images rows.
 * Favicon-tagged rows win over logo-tagged rows. Returns the winner's
 * `storage_path`, or null when no qualifying row exists.
 */
export function pickLogoImage(
  rows: ReadonlyArray<{
    tags?: readonly string[] | null | undefined
    storage_path?: string | null
  }>,
): string | null {
  let bestPath: string | null = null
  let bestRank = Infinity // lower is better: 0 = favicon, 1 = logo

  for (const row of rows) {
    if (!row.storage_path) continue
    const tags = row.tags ?? []
    let rank: number | null = null
    if (tags.includes('favicon')) rank = 0
    else if (tags.includes('logo')) rank = 1
    if (rank !== null && rank < bestRank) {
      bestRank = rank
      bestPath = row.storage_path
    }
  }

  return bestPath
}

/**
 * Downloads a favicon URL, validates it, and stores it in the brand-images
 * bucket. Returns the `storage_path` on success, or `null` on any failure.
 *
 * Upserts into `brand_images` keyed on `brand_id` + `source = 'favicon'` so
 * re-runs replace rather than duplicate.
 */
export async function downloadAndStoreFavicon(
  url: string,
  brandId: string,
  supabase: {
    storage: {
      from: (bucket: string) => {
        upload: (
          path: string,
          body: Buffer,
          options: { contentType: string; cacheControl: string },
        ) => Promise<{ error: { message: string } | null }>
      }
    }
    from: (table: string) => {
      upsert: (
        row: Record<string, unknown>,
        options: { onConflict: string },
      ) => Promise<{ error: { message: string } | null }>
    }
  },
): Promise<string | null> {
  return auditedCall(
    { provider: 'http', operation: 'fetch_favicon', kind: 'service' },
    async () => {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), FAVICON_FETCH_TIMEOUT_MS)

      try {
        const response = await fetch(url, { signal: controller.signal })
        clearTimeout(timeoutId)

        if (!response.ok) {
          console.warn(`[favicon] ${brandId}: fetch failed ${response.status}`)
          return null
        }

        const contentType = response.headers.get('content-type') ?? ''
        if (!isAcceptedFaviconContentType(contentType)) {
          console.warn(`[favicon] ${brandId}: rejected content-type ${contentType}`)
          return null
        }

        const ext = faviconExtFromContentType(contentType)!
        const buffer = Buffer.from(await response.arrayBuffer())

        // SVGs skip sharp dimension check entirely
        if (ext !== 'svg') {
          let metadata: { width?: number; height?: number }
          try {
            metadata = await sharp(buffer).metadata()
          } catch {
            console.warn(`[favicon] ${brandId}: corrupt image data`)
            return null
          }

          const { width, height } = metadata
          if (
            !width ||
            !height ||
            !isValidFaviconDimensions(width, height, ext)
          ) {
            console.warn(
              `[favicon] ${brandId}: too small (${width ?? 0}x${height ?? 0}, floor ${MIN_FAVICON_SHORT_EDGE_PX}px)`,
            )
            return null
          }
        }

        const storagePath = `brands/${brandId}/favicon.${ext}`

        // Favicon path is deterministic, so the upload is idempotent by key.
        const { error: uploadError } = await uploadWithRetry(() =>
          supabase.storage
            .from('brand-images')
            .upload(storagePath, buffer, {
              contentType,
              cacheControl: '31536000',
            }),
        )

        if (uploadError) {
          console.warn(`[favicon] ${brandId}: upload failed — ${uploadError.message}`)
          return null
        }

        const { error: upsertError } = await supabase
          .from('brand_images')
          .upsert(
            {
              brand_id: brandId,
              storage_path: storagePath,
              source: 'favicon',
              tags: ['favicon'],
              status: 'active',
              sort_order: 0,
            },
            { onConflict: 'brand_id,source' },
          )

        if (upsertError) {
          console.warn(`[favicon] ${brandId}: upsert failed — ${upsertError.message}`)
          return null
        }

        return storagePath
      } catch (err) {
        clearTimeout(timeoutId)
        console.warn(`[favicon] ${brandId}: ${err instanceof Error ? err.message : err}`)
        return null
      }
    },
    { subjectId: brandId },
  )
}
