import sharp from 'sharp'

import { processImage } from '@/lib/security/image-processor'
import { createServiceClient } from '@/lib/supabase/server'
import { mapWithConcurrency } from './concurrency'
import type { CandidateImage, CandidateImageSource } from './enrich-phases/candidate-pool'
import {
  brandTarget,
  targetImageStorage,
  type EnrichmentTarget,
} from './enrichment-target'

const IMAGE_FETCH_TIMEOUT_MS = 10_000
const MIN_IMAGE_SIZE_BYTES = 5_120
// Short-edge floor, applied to every source with no per-source exception.
// Measured against 231 human-labeled images: the old `max(w,h) >= 400` rule
// scored 50% precision because it passes banner strips on width alone;
// `min(w,h) >= 480` scores 65% while keeping more good images.
const MIN_IMAGE_SHORT_EDGE_PX = 480
// No labeled good image exceeded 3:1, and the old 4.0 cap never bound on
// anything good. 2.0 keeps square/near-square (55% of good images) and prunes
// banners and tall portraits (58% of bad images).
const MAX_IMAGE_ASPECT_RATIO = 2.0
// Catches degenerate input — solid-colour fills and blank canvases. It is NOT
// a quality signal and must not be raised as if it were: measured against 231
// human-labeled images, entropy does not separate good from bad at all
// (keep p50 6.92 vs reject p50 7.03), and every floor above this one loses
// more good images than it blocks bad ones.
const MIN_IMAGE_ENTROPY = 0.5
// Content types that are definitively not an image. Anything else — including
// application/octet-stream and a missing header — falls through to sharp.
const NON_IMAGE_CONTENT_TYPE_RE = /^(?:text\/|application\/(?:json|xml|pdf|zip|javascript)|video\/|audio\/)/i

/**
 * Fast-path reject for responses that cannot be an image. Deliberately
 * permissive: a CDN serving a real image as application/octet-stream must not
 * be rejected on the header alone (static.91app.com does exactly this for every
 * asset). sharp's decode and the processImage format allowlist are the actual
 * guarantee — this only avoids decoding an obvious HTML error page.
 */
export function isNonImageContentType(contentType: string): boolean {
  return NON_IMAGE_CONTENT_TYPE_RE.test(contentType)
}
// Each unit here is an HTTP fetch plus a sharp decode/stats/resize/webp encode
// plus a storage upload, and this already runs multiplied by the per-brand
// enrichment concurrency. Bound the fan-out instead of firing every candidate
// at once.
const IMAGE_DOWNLOAD_CONCURRENCY = 4

type DownloadImageCandidate = string | CandidateImage

function normalizeCandidate(candidate: DownloadImageCandidate): {
  url: string
  source: CandidateImageSource
  sourceUrl: string
} {
  return typeof candidate === 'string'
    ? { url: candidate, source: 'google_image', sourceUrl: candidate }
    : {
        url: candidate.url,
        source: candidate.source,
        sourceUrl: candidate.sourceUrl ?? candidate.url,
      }
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

export function buildImageProviderMetadata(
  candidate: DownloadImageCandidate,
  resolvedFetchUrl: string,
): Record<string, string | number> {
  if (typeof candidate === 'string') return { resolvedFetchUrl }

  return Object.fromEntries(
    Object.entries({
      resolvedFetchUrl,
      method: candidate.method,
      pageUrl: candidate.pageUrl,
      previewUrl: candidate.previewUrl,
      title: candidate.title,
      source: candidate.providerSource,
      domain: candidate.domain,
      position: candidate.position,
      query: candidate.query,
      auditResultId: candidate.auditResultId,
      imageWidth: candidate.imageWidth,
      imageHeight: candidate.imageHeight,
      thumbnailWidth: candidate.thumbnailWidth,
      thumbnailHeight: candidate.thumbnailHeight,
    }).filter((entry): entry is [string, string | number] => entry[1] !== undefined),
  )
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

type ExistingImageRow = {
  source_url: string | null
  status: string
  storage_path: string | null
  url: string
}

async function loadExistingCandidates(
  supabase: ReturnType<typeof createServiceClient>,
  target: EnrichmentTarget,
  candidates: DownloadImageCandidate[],
): Promise<Map<string, ExistingImageRow>> {
  const sourceUrls = [...new Set(candidates.map((candidate) => normalizeCandidate(candidate).sourceUrl).filter(Boolean))]
  if (sourceUrls.length === 0) return new Map()

  const storage = targetImageStorage(target)
  const { data, error } = await supabase
    .from(storage.table)
    .select('source_url, status, storage_path, url')
    .eq(storage.foreignKey, target.id)
    .in('source_url', sourceUrls) as { data: ExistingImageRow[] | null; error: { message: string } | null }
  if (error) throw error

  return new Map(
    (data ?? [])
      .filter((row) => typeof row.source_url === 'string')
      .map((row) => [row.source_url as string, row]),
  )
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

/**
 * Perceptual-duplicate guard for one brand's download run.
 *
 * Loaded once and held in memory for two reasons. The previous per-candidate
 * query re-read every stored hash for the brand on every candidate, and — the
 * real defect — candidates run concurrently, so two copies of the same photo
 * could both query before either was inserted and both be accepted. `claim`
 * closes that: it tests and records in a single synchronous step, with no await
 * in between, so concurrent callers cannot interleave.
 */
async function loadPerceptualHashGuard(
  supabase: ReturnType<typeof createServiceClient>,
  target: EnrichmentTarget
): Promise<{ claim: (hash: string) => boolean }> {
  const storage = targetImageStorage(target)
  const { data } = await supabase
    .from(storage.table)
    .select('phash')
    .eq(storage.foreignKey, target.id)
    .not('phash', 'is', null) as { data: Array<{ phash: string }> | null }

  const hashes = (data ?? []).map((row) => row.phash)

  return {
    /** True if `hash` is new and now claimed; false if it duplicates a known one. */
    claim(hash: string): boolean {
      if (hashes.some((known) => hammingDistance(known, hash) < PHASH_HAMMING_THRESHOLD)) {
        return false
      }
      hashes.push(hash)
      return true
    },
  }
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
  const existingBySource = await loadExistingCandidates(supabase, target, dedupedCandidates)
  const phashGuard = await loadPerceptualHashGuard(supabase, target)

  return mapWithConcurrency(
    dedupedCandidates,
    IMAGE_DOWNLOAD_CONCURRENCY,
    async (candidate): Promise<string | null> => {
      const { url, source, sourceUrl } = normalizeCandidate(candidate)
      const existing = existingBySource.get(sourceUrl)
      if (existing?.status === 'rejected') return null
      if (existing && (existing.status === 'active' || existing.storage_path)) return existing.url

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

        // content-type is a cheap fast-path reject, NOT the arbiter. Some CDNs
        // serve perfectly valid images as application/octet-stream —
        // static.91app.com does it for every asset, and 91app is one of the
        // three dominant Taiwanese storefront platforms, so trusting the header
        // silently discarded five usable 1200px images for a single brand in a
        // spot check. Reject only what is definitively not an image and let
        // sharp's decode plus the processImage format allowlist below be the
        // real guarantee.
        const contentType = response.headers.get('content-type') ?? ''
        if (isNonImageContentType(contentType)) {
          throw new Error(`Not an image (content-type: ${contentType}), skipping`)
        }

        const blob = await response.blob()
        if (blob.size < MIN_IMAGE_SIZE_BYTES) {
          throw new Error(`Image too small (${blob.size} bytes), skipping`)
        }

        const buffer = Buffer.from(await blob.arrayBuffer())
        const image = sharp(buffer)
        let metadata: { width?: number; height?: number }
        let stats: {
          dominant: { r: number; g: number; b: number }
          entropy?: number
          sharpness?: number
        }
        try {
          ;[metadata, stats] = await Promise.all([
            image.metadata(),
            sharp(buffer).stats(),
          ])
        } catch {
          throw new Error('Corrupt image data, skipping')
        }
        const { width, height } = metadata
        if (!width || !height || Math.min(width, height) < MIN_IMAGE_SHORT_EDGE_PX) {
          throw new Error(
            `Image short edge too small (${width ?? 0}x${height ?? 0}, floor ${MIN_IMAGE_SHORT_EDGE_PX}px), skipping`
          )
        }

        const aspectRatio = Math.max(width, height) / Math.min(width, height)
        if (aspectRatio > MAX_IMAGE_ASPECT_RATIO) {
          throw new Error(
            `Image aspect ratio too extreme (${aspectRatio.toFixed(1)}:1, cap ${MAX_IMAGE_ASPECT_RATIO.toFixed(1)}:1), skipping`
          )
        }

        // Both values are recorded on the row below, but only entropy gates,
        // and only against degenerate input. Sharpness deliberately does NOT
        // gate: measured against 231 human-labeled images it runs backwards
        // (keep p50 2.66 vs reject p50 4.20, and low_visual_quality rejects
        // p50 3.98). sharp's `sharpness` scores high-frequency content, so
        // text-dominant promos, screenshots and busy collages — exactly what
        // we want to reject — out-score a clean product shot on a soft
        // background. Storing it keeps the door open for a better-labeled
        // pass; gating on it would discard good images.
        const { entropy, sharpness } = stats
        if (typeof entropy === 'number' && entropy < MIN_IMAGE_ENTROPY) {
          throw new Error(
            `Image entropy too low (${entropy.toFixed(2)}), likely blank/flat, skipping`
          )
        }

        const phash = await computeDHash(buffer)
        if (!phashGuard.claim(phash)) {
          throw new Error(`Perceptual duplicate detected (dHash), skipping`)
        }

        // Static images only: every candidate must survive processImage, which
        // enforces a jpeg/png/webp format allowlist — GIFs (which sharp would
        // otherwise silently flatten to their first frame), SVGs and every
        // other format throw, and the candidate is dropped.
        const processed = await processImage(buffer, {
          maxWidth: 1600,
          maxHeight: 1600,
          maxFileSizeBytes: 30 * 1024 * 1024,
        })
        const uploadBuffer = processed.buffer
        const uploadContentType = processed.contentType
        const uploadWidth = processed.width
        const uploadHeight = processed.height
        const ext = 'webp'

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
          .insert({
            [storage.foreignKey]: target.id,
            url: publicUrl,
            source,
            source_url: sourceUrl,
            storage_path: filename,
            status: 'candidate',
            provider_metadata: buildImageProviderMetadata(candidate, url),
            width: uploadWidth,
            height: uploadHeight,
            dominant_color: dominantColor,
            phash,
            sharpness: sharpness ?? null,
            entropy: entropy ?? null,
          } as never)

        if (insertError) {
          await supabase.storage.from('brand-images').remove([filename])
          if ((insertError as { code?: string }).code === '23505') {
            return existing?.url ?? null
          }
          throw insertError
        }

        return publicUrl
      } catch (err) {
        clearTimeout(timeoutId)
        console.warn(`Failed to download image ${url}:`, err)
        // Positional result shape: a rejected candidate is a null slot, never
        // a thrown error — callers index this array against a parallel array.
        return null
      }
    },
  )
}
