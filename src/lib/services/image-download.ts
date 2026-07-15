import sharp from 'sharp'

import { processImage } from '@/lib/security/image-processor'
import { createServiceClient } from '@/lib/supabase/server'
import type { CandidateImageSource } from './enrich-phases/candidate-pool'
import {
  brandTarget,
  targetImageStorage,
  type EnrichmentTarget,
} from './enrichment-target'

const IMAGE_FETCH_TIMEOUT_MS = 10_000
const MIN_IMAGE_SIZE_BYTES = 5_120
const MIN_IMAGE_DIMENSION_PX = 400
const SOURCE_MIN_DIMENSION: Partial<Record<CandidateImageSource, number>> = {
  json_ld: 300,
}

type DownloadImageCandidate = string | {
  url: string
  source: CandidateImageSource
}

function getExtFromContentType(contentType: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
  }
  return map[contentType] ?? 'jpg'
}

function normalizeCandidate(candidate: DownloadImageCandidate): {
  url: string
  source: CandidateImageSource
} {
  return typeof candidate === 'string'
    ? { url: candidate, source: 'google_image' }
    : candidate
}

function extractIgCacheKey(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (!parsed.hostname.includes('cdninstagram.com')) return null
    const match = parsed.search.match(/ig_cache_key=([A-Za-z0-9%]+)/)
    return match ? decodeURIComponent(match[1]) : null
  } catch {
    return null
  }
}

function deduplicateCandidates(candidates: DownloadImageCandidate[]): DownloadImageCandidate[] {
  const seen = new Set<string>()
  return candidates.filter((candidate) => {
    const { url } = normalizeCandidate(candidate)
    const igKey = extractIgCacheKey(url)
    const dedupKey = igKey ?? url
    if (seen.has(dedupKey)) return false
    seen.add(dedupKey)
    return true
  })
}

const PHASH_HAMMING_THRESHOLD = 5

export async function computeDHash(buffer: Buffer): Promise<string> {
  const pixels = await sharp(buffer)
    .greyscale()
    .resize(9, 8, { fit: 'fill' })
    .raw()
    .toBuffer()
  let hash = ''
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      hash += pixels[y * 9 + x] > pixels[y * 9 + x + 1] ? '1' : '0'
    }
  }
  return hash
}

function hammingDistance(a: string, b: string): number {
  let dist = 0
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) dist++
  }
  return dist
}

async function isDuplicateByHash(
  supabase: ReturnType<typeof createServiceClient>,
  target: EnrichmentTarget,
  hash: string
): Promise<boolean> {
  const storage = targetImageStorage(target)
  const { data } = await supabase
    .from(storage.table)
    .select('phash')
    .eq(storage.foreignKey, target.id)
    .not('phash', 'is', null) as { data: Array<{ phash: string }> | null }
  if (!data) return false
  return data.some((row) => hammingDistance(row.phash, hash) < PHASH_HAMMING_THRESHOLD)
}

function channelToHex(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value)))
    .toString(16)
    .padStart(2, '0')
}

export function dominantColorToHex(dominant: { r: number; g: number; b: number }): string {
  return `#${channelToHex(dominant.r)}${channelToHex(dominant.g)}${channelToHex(dominant.b)}`
}

export async function downloadAndStoreImages(
  candidates: DownloadImageCandidate[],
  targetOrBrandId: EnrichmentTarget | string
): Promise<(string | null)[]> {
  if (candidates.length === 0) return []

  const dedupedCandidates = deduplicateCandidates(candidates)
  if (dedupedCandidates.length < candidates.length) {
    console.log(`  [IMAGE-DEDUP] ${candidates.length} → ${dedupedCandidates.length} candidates (${candidates.length - dedupedCandidates.length} IG dupes removed)`)
  }

  const supabase = createServiceClient()
  const target = typeof targetOrBrandId === 'string'
    ? brandTarget(targetOrBrandId)
    : targetOrBrandId
  const storage = targetImageStorage(target)

  const results = await Promise.allSettled(
    dedupedCandidates.map(async (candidate) => {
      const { url, source } = normalizeCandidate(candidate)
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

        const contentType =
          response.headers.get('content-type') ?? ''
        if (!contentType.startsWith('image/')) {
          throw new Error(`Not an image (content-type: ${contentType}), skipping`)
        }

        const blob = await response.blob()
        if (blob.size < MIN_IMAGE_SIZE_BYTES) {
          throw new Error(`Image too small (${blob.size} bytes), skipping`)
        }

        const buffer = Buffer.from(await blob.arrayBuffer())
        const image = sharp(buffer)
        let metadata: { width?: number; height?: number }
        let stats: { dominant: { r: number; g: number; b: number }; entropy?: number }
        try {
          ;[metadata, stats] = await Promise.all([
            image.metadata(),
            sharp(buffer).stats(),
          ])
        } catch {
          throw new Error('Corrupt image data, skipping')
        }
        const { width, height } = metadata
        if (
          !width ||
          !height ||
          Math.max(width, height) < (SOURCE_MIN_DIMENSION[source] ?? MIN_IMAGE_DIMENSION_PX)
        ) {
          throw new Error(
            `Image resolution too low (${width ?? 0}x${height ?? 0}), skipping`
          )
        }

        const aspectRatio = Math.max(width, height) / Math.min(width, height)
        if (aspectRatio > 4.0) {
          throw new Error(
            `Image aspect ratio too extreme (${aspectRatio.toFixed(1)}:1), skipping`
          )
        }

        if (typeof stats.entropy === 'number' && stats.entropy < 0.5) {
          throw new Error(
            `Image entropy too low (${stats.entropy.toFixed(2)}), likely blank/solid, skipping`
          )
        }

        const phash = await computeDHash(buffer)
        if (await isDuplicateByHash(supabase as never, target, phash)) {
          throw new Error(`Perceptual duplicate detected (dHash), skipping`)
        }

        let uploadBuffer: Buffer = buffer
        let uploadContentType = contentType
        let uploadWidth = width
        let uploadHeight = height
        let ext = getExtFromContentType(contentType || 'image/jpeg')
        if (contentType !== 'image/gif') {
          const processed = await processImage(buffer, {
            maxWidth: 1600,
            maxHeight: 1600,
            maxFileSizeBytes: 30 * 1024 * 1024,
          })
          uploadBuffer = processed.buffer
          uploadContentType = processed.contentType
          uploadWidth = processed.width
          uploadHeight = processed.height
          ext = 'webp'
        }

        const filename = `${storage.prefix}/${target.id}/${crypto.randomUUID()}.${ext}`
        const dominantColor = dominantColorToHex(stats.dominant)

        const { error: uploadError } = await supabase.storage
          .from('brand-images')
          .upload(filename, uploadBuffer, {
            contentType: uploadContentType,
            cacheControl: '31536000',
          })

        if (uploadError) {
          throw uploadError
        }

        const {
          data: { publicUrl },
        } = supabase.storage.from('brand-images').getPublicUrl(filename)

        const { error: insertError } = await supabase
          .from(storage.table)
          .upsert({
            [storage.foreignKey]: target.id,
            url: publicUrl,
            source,
            source_url: url,
            storage_path: filename,
            status: 'active',
            width: uploadWidth,
            height: uploadHeight,
            dominant_color: dominantColor,
            phash,
          } as never, { onConflict: `${storage.foreignKey},source_url` })

        if (insertError) {
          await supabase.storage.from('brand-images').remove([filename])
          throw insertError
        }

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
