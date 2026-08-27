import sharp from 'sharp'
import { auditedCall } from '@/lib/audit'

import { processImage } from '@/lib/security/image-processor'
import { createServiceClient } from '@/lib/supabase/service'
import { mapWithConcurrency } from './_shared/concurrency'
import type {
  CandidateImage,
  CandidateImageSource,
} from './enrich-phases/candidate-pool'
import {
  brandTarget,
  targetImageStorage,
  type EnrichmentTarget,
} from './_shared/enrichment-target'
import { uploadWithRetry } from './storage-retry'

const IMAGE_FETCH_TIMEOUT_MS = 10_000
const MIN_IMAGE_SIZE_BYTES = 5_120
// Short-edge floor, applied to every source with no per-source exception.
// Measured against 231 human-labeled images: the old `max(w,h) >= 400` rule
// scored 50% precision because it passes banner strips on width alone;
// `min(w,h) >= 480` scores 65% while keeping more good images.
const MIN_IMAGE_SHORT_EDGE_PX = 480
// Set at the boundary the labelled data actually supports: no labelled good
// image exceeded 3:1. It sat at 2.0 for a while, which contradicted that same
// evidence and cost real images — a brand's own 1600x670 product banners
// (2.39:1) were discarded while the genuine junk this gate exists for is far
// more extreme (750x4050 description strips, 5.4:1).
//
// Shape between 2.0 and 3.0 is handled by the crop-damage term at ranking time
// instead (`cropDamage` in src/lib/images/crop-damage.ts, weighted by
// CROP_DAMAGE_WEIGHT in the classify phase): a wide image crops badly in the
// landscape hero frame but is a perfectly good gallery entry, which is a
// ranking question, not a gate. The band is still covered — that same 1600x670
// banner earns ~10 points of crop damage, which is what the deleted flat
// WIDE_ASPECT_PENALTY used to charge it.
const MAX_IMAGE_ASPECT_RATIO = 3.0
// Catches degenerate input — solid-colour fills and blank canvases. It is NOT
// a quality signal and must not be raised as if it were: measured against 231
// human-labeled images, entropy does not separate good from bad at all
// (keep p50 6.92 vs reject p50 7.03), and every floor above this one loses
// more good images than it blocks bad ones.
const MIN_IMAGE_ENTROPY = 0.5
// Content types that are definitively not an image. Anything else — including
// application/octet-stream and a missing header — falls through to sharp.
const NON_IMAGE_CONTENT_TYPE_RE =
  /^(?:text\/|application\/(?:json|xml|pdf|zip|javascript)|video\/|audio\/)/i

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
// Exported because the vision loader mirrors it deliberately (classify-images.ts):
// same work, same multiplier above it, so a copied literal is drift waiting to happen.
export const IMAGE_DOWNLOAD_CONCURRENCY = 4

export const IMAGE_REJECTION_CODES = [
  'fetch_failed',
  'non_image',
  'byte_size',
  'decode_failed',
  'short_edge',
  'aspect_ratio',
  'low_entropy',
  'duplicate',
  'process_failed',
  'upload_failed',
  'persist_failed',
] as const
export type ImageRejectionCode = (typeof IMAGE_REJECTION_CODES)[number]

class ImageRejection extends Error {
  constructor(
    readonly code: ImageRejectionCode,
    detail: string,
  ) {
    super(detail.slice(0, 500))
  }
}

export function imageRejectionCode(error: unknown): ImageRejectionCode | null {
  return error instanceof ImageRejection ? error.code : null
}

export type ProductionImageGateResult = {
  width: number
  height: number
  dominant: { r: number; g: number; b: number }
  entropy: number | undefined
  sharpness: number | undefined
  phash: string
  processed: Awaited<ReturnType<typeof processImage>>
}

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
    }).filter(
      (entry): entry is [string, string | number] => entry[1] !== undefined,
    ),
  )
}

function deduplicateCandidates(
  candidates: DownloadImageCandidate[],
): DownloadImageCandidate[] {
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

function candidateDedupKey(candidate: DownloadImageCandidate): string {
  const { url } = normalizeCandidate(candidate)
  return extractIgCacheKey(url) ?? url
}

type ExistingImageRow = {
  source_url: string | null
  status: string
  storage_path: string | null
}

/**
 * PostgREST sends `.in()` as a GET query string, so the limit is bytes, not
 * rows. Instagram and Meta CDN URLs carry signed parameters and run past 700
 * characters each, so a couple of dozen candidates is enough to blow the URI
 * limit — the request fails, the raw Supabase error object is thrown, and
 * because it is not an `Error` it used to surface as `[object Object]` after
 * taking down the whole images phase for that brand. Chunk by cumulative
 * length rather than by count, since one long URL costs as much as ten short
 * ones.
 */
const IN_FILTER_URL_BUDGET = 2_000

function chunkByLength(values: string[], budget: number): string[][] {
  const chunks: string[][] = []
  let current: string[] = []
  let size = 0
  for (const value of values) {
    // A single over-budget URL still has to go somewhere: give it its own chunk
    // rather than dropping it or wedging it into a full one.
    if (current.length > 0 && size + value.length > budget) {
      chunks.push(current)
      current = []
      size = 0
    }
    current.push(value)
    size += value.length
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

async function loadExistingCandidates(
  supabase: ReturnType<typeof createServiceClient>,
  target: EnrichmentTarget,
  candidates: DownloadImageCandidate[],
): Promise<Map<string, ExistingImageRow>> {
  const sourceUrls = [
    ...new Set(
      candidates
        .map((candidate) => normalizeCandidate(candidate).sourceUrl)
        .filter(Boolean),
    ),
  ]
  if (sourceUrls.length === 0) return new Map()

  const storage = targetImageStorage(target)
  const rows: ExistingImageRow[] = []
  for (const chunk of chunkByLength(sourceUrls, IN_FILTER_URL_BUDGET)) {
    const { data, error } = (await supabase
      .from(storage.table)
      .select('source_url, status, storage_path')
      .eq(storage.foreignKey, target.id)
      .in('source_url', chunk)) as {
      data: ExistingImageRow[] | null
      error: { message: string } | null
    }
    if (error)
      throw new Error(`loadExistingCandidates failed: ${JSON.stringify(error)}`)
    rows.push(...(data ?? []))
  }

  return new Map(
    rows
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

/** Production's byte/decode/dimension/format gates, shared by live evaluation. */
export async function applyProductionImageGates(
  buffer: Buffer,
  contentType = '',
): Promise<ProductionImageGateResult> {
  if (isNonImageContentType(contentType)) {
    throw new ImageRejection('non_image', `Not an image (${contentType})`)
  }
  if (buffer.byteLength < MIN_IMAGE_SIZE_BYTES) {
    throw new ImageRejection(
      'byte_size',
      `Image too small (${buffer.byteLength} bytes)`,
    )
  }
  let metadata: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>
  let stats: Awaited<ReturnType<ReturnType<typeof sharp>['stats']>>
  try {
    ;[metadata, stats] = await Promise.all([
      sharp(buffer).metadata(),
      sharp(buffer).stats(),
    ])
  } catch {
    throw new ImageRejection('decode_failed', 'Corrupt image data')
  }
  const width = metadata.width ?? 0
  const height = metadata.height ?? 0
  if (!width || !height || Math.min(width, height) < MIN_IMAGE_SHORT_EDGE_PX) {
    throw new ImageRejection(
      'short_edge',
      `Image short edge too small (${width}x${height})`,
    )
  }
  const aspectRatio = Math.max(width, height) / Math.min(width, height)
  if (aspectRatio > MAX_IMAGE_ASPECT_RATIO) {
    throw new ImageRejection(
      'aspect_ratio',
      `Image aspect ratio too extreme (${aspectRatio.toFixed(1)}:1)`,
    )
  }
  if (typeof stats.entropy === 'number' && stats.entropy < MIN_IMAGE_ENTROPY) {
    throw new ImageRejection(
      'low_entropy',
      `Image entropy too low (${stats.entropy.toFixed(2)})`,
    )
  }
  let processed: Awaited<ReturnType<typeof processImage>>
  try {
    processed = await processImage(buffer, {
      maxWidth: 1600,
      maxHeight: 1600,
      maxFileSizeBytes: 30 * 1024 * 1024,
    })
  } catch {
    throw new ImageRejection('process_failed', 'Image processing failed')
  }
  let phash: string
  try {
    phash = await computeDHash(buffer)
  } catch {
    throw new ImageRejection('process_failed', 'Image hashing failed')
  }
  return {
    width,
    height,
    dominant: stats.dominant,
    entropy: stats.entropy,
    sharpness: stats.sharpness,
    phash,
    processed,
  }
}

function hammingDistance(a: string, b: string): number {
  let dist = 0
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) dist++
  }
  return dist
}

export function isPerceptualDuplicate(
  hash: string,
  knownHashes: readonly string[],
): boolean {
  return knownHashes.some(
    (known) => hammingDistance(known, hash) < PHASH_HAMMING_THRESHOLD,
  )
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
  target: EnrichmentTarget,
): Promise<{ claim: (hash: string) => boolean }> {
  const storage = targetImageStorage(target)
  const { data } = (await supabase
    .from(storage.table)
    .select('phash')
    .eq(storage.foreignKey, target.id)
    .not('phash', 'is', null)) as { data: Array<{ phash: string }> | null }

  const hashes = (data ?? []).map((row) => row.phash)

  return {
    /** True if `hash` is new and now claimed; false if it duplicates a known one. */
    claim(hash: string): boolean {
      if (isPerceptualDuplicate(hash, hashes)) {
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

export function dominantColorToHex(dominant: {
  r: number
  g: number
  b: number
}): string {
  return `#${channelToHex(dominant.r)}${channelToHex(dominant.g)}${channelToHex(dominant.b)}`
}

/**
 * Downloads each candidate and stores it, returning the BUCKET KEY per slot —
 * positionally, with a null for anything that failed.
 *
 * Since DEV-1551 task 12 this returns keys, not public URLs: the bucket is
 * private, so a public URL is a dead link. Callers that need something
 * renderable pass the key through `imagePathToUrl`.
 */
export async function downloadAndStoreImages(
  candidates: DownloadImageCandidate[],
  targetOrBrandId: EnrichmentTarget | string,
): Promise<(string | null)[]> {
  if (candidates.length === 0) return []

  return auditedCall(
    {
      provider: 'images',
      operation: 'downloadAndStoreImages',
      kind: 'service',
    },
    async (ctx) => {
      const rejectionCounts: Record<string, Record<string, number>> = {}
      let cached = 0
      let stored = 0
      let previouslyRejected = 0
      const reject = (
        candidate: DownloadImageCandidate,
        code: ImageRejectionCode,
      ) => {
        const method =
          typeof candidate === 'string'
            ? 'google_image'
            : (candidate.method ?? candidate.source)
        const counts = rejectionCounts[method] ?? {}
        counts[code] = (counts[code] ?? 0) + 1
        rejectionCounts[method] = counts
      }
      const seenDedupKeys = new Set<string>()
      for (const candidate of candidates) {
        const { url } = normalizeCandidate(candidate)
        const key = extractIgCacheKey(url) ?? url
        if (seenDedupKeys.has(key)) reject(candidate, 'duplicate')
        else seenDedupKeys.add(key)
      }
      const dedupedCandidates = deduplicateCandidates(candidates)
      const firstIndexByKey = new Map<string, number>()
      const uniqueIndexByKey = new Map<string, number>()
      candidates.forEach((candidate, index) => {
        const key = candidateDedupKey(candidate)
        if (firstIndexByKey.has(key)) return
        firstIndexByKey.set(key, index)
        uniqueIndexByKey.set(key, uniqueIndexByKey.size)
      })
      Object.assign(ctx.summary, {
        attempted: candidates.length,
        deduplicated: candidates.length - dedupedCandidates.length,
        unique: dedupedCandidates.length,
      })
      if (dedupedCandidates.length < candidates.length) {
        console.log(
          `  [IMAGE-DEDUP] ${candidates.length} → ${dedupedCandidates.length} candidates (${candidates.length - dedupedCandidates.length} IG dupes removed)`,
        )
      }

      const supabase = createServiceClient()
      const target =
        typeof targetOrBrandId === 'string'
          ? brandTarget(targetOrBrandId)
          : targetOrBrandId
      const storage = targetImageStorage(target)
      const existingBySource = await loadExistingCandidates(
        supabase,
        target,
        dedupedCandidates,
      )
      const phashGuard = await loadPerceptualHashGuard(supabase, target)

      const uniqueResults = await mapWithConcurrency(
        dedupedCandidates,
        IMAGE_DOWNLOAD_CONCURRENCY,
        async (candidate): Promise<string | null> => {
          const { url, source, sourceUrl } = normalizeCandidate(candidate)
          const existing = existingBySource.get(sourceUrl)
          if (existing?.status === 'rejected') {
            previouslyRejected += 1
            return null
          }
          if (
            existing &&
            (existing.status === 'active' || existing.storage_path)
          ) {
            cached += 1
            return existing.storage_path
          }

          const controller = new AbortController()
          const timeoutId = setTimeout(
            () => controller.abort(),
            IMAGE_FETCH_TIMEOUT_MS,
          )

          try {
            const response = await fetch(url, { signal: controller.signal })
            clearTimeout(timeoutId)

            if (!response.ok) {
              throw new ImageRejection(
                'fetch_failed',
                `Failed to fetch image: ${response.status}`,
              )
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
            const buffer = Buffer.from(await response.arrayBuffer())
            const gate = await applyProductionImageGates(buffer, contentType)
            const { entropy, sharpness, phash, processed } = gate
            if (!phashGuard.claim(phash)) {
              throw new ImageRejection(
                'duplicate',
                'Perceptual duplicate detected',
              )
            }
            const uploadBuffer = processed.buffer
            const uploadContentType = processed.contentType
            const uploadWidth = processed.width
            const uploadHeight = processed.height
            const ext = 'webp'

            const filename = `${storage.prefix}/${target.id}/${crypto.randomUUID()}.${ext}`
            const dominantColor = dominantColorToHex(gate.dominant)

            // The random path is a create-only upload; retrying an ambiguous
            // response could create a duplicate object.
            const { error: uploadError } = await uploadWithRetry(
              () =>
                supabase.storage
                  .from('brand-images')
                  .upload(filename, uploadBuffer, {
                    contentType: uploadContentType,
                    cacheControl: '31536000',
                  }),
              { idempotent: false },
            )

            if (uploadError) {
              throw new ImageRejection(
                'upload_failed',
                JSON.stringify(uploadError),
              )
            }

            // DEV-1551 task 12: no public-URL lookup. The bucket is private, so
            // the only durable reference is the bucket key, and `/i/<key>` is derived
            // from it at read time.
            const { error: insertError } = await supabase
              .from(storage.table)
              .insert({
                [storage.foreignKey]: target.id,
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
              await uploadWithRetry(() =>
                supabase.storage.from('brand-images').remove([filename]),
              )
              if ((insertError as { code?: string }).code === '23505') {
                return existing?.storage_path ?? null
              }
              throw new ImageRejection(
                'persist_failed',
                JSON.stringify(insertError),
              )
            }

            stored += 1
            return filename
          } catch (err) {
            clearTimeout(timeoutId)
            reject(
              candidate,
              err instanceof ImageRejection ? err.code : 'fetch_failed',
            )
            console.warn(`Failed to download image ${url}:`, err)
            // Positional result shape: a rejected candidate is a null slot, never
            // a thrown error — callers index this array against a parallel array.
            return null
          }
        },
      ).finally(() =>
        Object.assign(ctx.summary, {
          cached,
          stored,
          previouslyRejected,
          rejectionCounts,
        }),
      )
      return candidates.map((candidate, index) => {
        const key = candidateDedupKey(candidate)
        if (firstIndexByKey.get(key) !== index) return null
        const uniqueIndex = uniqueIndexByKey.get(key)
        return uniqueIndex === undefined ? null : (uniqueResults[uniqueIndex] ?? null)
      })
    },
  )
}
