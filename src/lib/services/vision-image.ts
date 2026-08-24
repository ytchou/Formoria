import sharp from 'sharp'
import { auditedCall } from '@/lib/audit'
import { createServiceClient } from '@/lib/supabase/service'
import { storageKeyFromPublicUrlForRead } from './image-upload'
import { uploadWithRetry } from './storage-retry'

const BRAND_IMAGES_BUCKET = 'brand-images'

/**
 * Same deadline as `IMAGE_FETCH_TIMEOUT_MS` in `image-download.ts` — both are a
 * single object over the same Supabase Storage edge. supabase-js issues a bare
 * `fetch` with no AbortSignal we can pass in, so this is a race, not a cancel:
 * on a half-open connection the underlying request is left to dangle and only
 * this promise settles. Without it `uploadWithRetry` never sees a result and the
 * whole classify phase hangs on one stalled socket.
 */
const DOWNLOAD_TIMEOUT_MS = 10_000

/**
 * Ceiling on the object we are willing to hand sharp, mirroring the guard
 * `image-processor.ts` already applies before every other decode. Set above the
 * largest object in the bucket today (7.96 MB against a p50 of 51 KB) so it
 * rejects nothing that currently classifies; it exists to bound the damage of
 * one pathological object at classify fan-out, not to filter real images.
 * Upgrade path if stored objects ever grow past it: stream the download and
 * resize incrementally instead of buffering the whole blob.
 */
const MAX_SOURCE_BYTES = 10 * 1024 * 1024

/**
 * Why the vision path inlines bytes instead of handing OpenAI a URL.
 *
 * DEV-1255 (2026-07-29): OpenAI's image fetcher timed out on our own Supabase
 * URLs, returned `invalid_image_url`, and the classifier recorded that as a
 * verdict — 18 live brand images were permanently destroyed. The fix at the
 * time was to hand OpenAI a *smaller* derivative built by Supabase's Storage
 * image-transformation endpoint, which kept their fetcher in the path and
 * merely made it likelier to succeed. That endpoint is separately metered:
 * DEV-1374 (2026-08-07) it reached 14,701 transformations against a quota of
 * 100 and, with the org spend cap on, took production down.
 *
 * Sending a base64 data URI removes OpenAI's fetcher from the path entirely, so
 * the failure class behind DEV-1255 becomes structurally impossible while the
 * transformation counter goes structurally to zero. `scripts/model-ab/run.ts` —
 * the eval harness that is ground truth for classifier quality — has always
 * worked this way; this module is that code promoted into production so both
 * sides encode the identical picture.
 */

/**
 * At `detail: 'low'` OpenAI downsamples to a single 512x512 tile regardless, so
 * 512 is the largest width that carries any information to the model.
 *
 * Quality 80 (the harness value) rather than the render endpoint's old 70, and
 * this IS a second lossy pass: every stored image already went through
 * `processImage`, which encodes webp at quality 80, so production re-encodes
 * webp-80 from a webp-80 source and the generation loss lands on exactly the
 * blur and text-density judgements the classifier scores. 80 is kept anyway
 * because `scripts/model-ab/run.ts` — which holds the original fetched bytes and
 * genuinely does encode once — is the eval baseline every verdict is compared
 * against; moving this number off the harness value would break that
 * comparability for a saving the model cannot see. The generation loss is the
 * accepted cost of parity.
 */
export const VISION_IMAGE_WIDTH = 512
const VISION_IMAGE_QUALITY = 80

/**
 * Pure: bytes -> 512px webp data URI. No I/O, no Supabase client, so
 * `scripts/model-ab/` can import it without dragging a service-role client into
 * a harness that deliberately runs on a write-blocking client.
 *
 * `withoutEnlargement` matters for parity: a 200px source must stay 200px in
 * both prod and the harness, or the two stop seeing the same image.
 */
export async function visionDataUri(buffer: Buffer): Promise<string> {
  const webp = await sharp(buffer)
    .resize({ width: VISION_IMAGE_WIDTH, withoutEnlargement: true })
    .webp({ quality: VISION_IMAGE_QUALITY })
    .toBuffer()

  return `data:image/webp;base64,${webp.toString('base64')}`
}

/**
 * Pure: the storage key an image row reads from, or null if it has no object of
 * ours behind it. `storage_path` when the row has one; otherwise the key is
 * recovered from the public URL through the READ-path helper, which accepts
 * both `brands/` and `submissions/` (see `storageKeyFromPublicUrlForRead` for
 * why the delete path deliberately does not).
 *
 * Since DEV-1551 task 12 nothing WRITES `url`, so the fallback only ever fires
 * for rows written before the flip. It stays because those rows are still in
 * the table: 23 of them once failed their classify phase permanently when an
 * earlier version of this lookup could not resolve them (DEV-1374).
 */
export function visionStorageKey(image: {
  storage_path?: string | null
  url?: string | null
}): string | null {
  return (
    image.storage_path?.trim() ||
    (image.url ? storageKeyFromPublicUrlForRead(image.url) : null)
  )
}

/**
 * Seam between the storage read and the encoder: everything that can go wrong
 * with a downloaded blob, decided on plain values. Exported so the failure
 * branches are testable without mocking the Supabase client, which
 * `check:test-boundaries` forbids outright.
 *
 * Returns null — never throws — for a download error, an oversized object, or
 * bytes sharp cannot decode.
 */
export async function encodeVisionDownload(
  key: string,
  result: { data: Blob | null; error: unknown },
): Promise<string | null> {
  if (result.error || !result.data) {
    console.error('[vision-image] download failed', {
      key,
      error: result.error,
    })
    return null
  }

  if (result.data.size > MAX_SOURCE_BYTES) {
    console.error('[vision-image] object exceeds the vision size ceiling', {
      key,
      bytes: result.data.size,
      ceiling: MAX_SOURCE_BYTES,
    })
    return null
  }

  try {
    return await visionDataUri(Buffer.from(await result.data.arrayBuffer()))
  } catch (error) {
    console.error('[vision-image] encode failed', { key, error })
    return null
  }
}

/**
 * Storage read + encode. Returns null on ANY failure — never throws.
 *
 * A null here must stay a *transient* signal: the caller leaves the row
 * untouched so the next run re-queues it. That property is what DEV-1255 lost
 * when a fetch failure was written as a verdict, and it is now enforced at this
 * boundary rather than by a retry loop downstream. Every null is logged: a
 * missing `SUPABASE_SERVICE_ROLE_KEY` otherwise reads as 100% unavailable
 * images with no output anywhere.
 *
 * Reads through `.download()` on the service client rather than fetching the
 * public URL. Egress is NOT a wash — the removed transformation endpoint
 * returned a ~38 KB derivative while `.download()` pulls the whole object
 * (p50 51 KB, mean 83 KB, max 7.96 MB over 10,876 rows) — but egress is bundled
 * bandwidth and the *transformation* is the separately metered line item that
 * DEV-1374 blew 147x, so trading a little more of the former for none of the
 * latter is the trade being made. A bare `fetch` under `src/` would also have to
 * be allowlisted past `check:audited-external-calls`.
 *
 * The service client is constructed here, not at module scope, so importing the
 * pure encoder above cannot pull a write-capable client into `scripts/model-ab/`.
 */
export async function loadVisionDataUri(image: {
  storage_path?: string | null
  url?: string | null
}): Promise<string | null> {
  const key = visionStorageKey(image)
  // An external/legacy hotlink has no object to download. Treat it as a load
  // failure so the row is skipped rather than judged on an image we never sent.
  if (!key) return null

  return auditedCall(
    { provider: 'images', operation: 'loadVisionImage', kind: 'service' },
    async (ctx) => {
      ctx.summary.key = key
      try {
        const supabase = createServiceClient()
        const { data, error } = await uploadWithRetry(() =>
          withDownloadTimeout(
            supabase.storage.from(BRAND_IMAGES_BUCKET).download(key),
          ),
        )
        // Key and byte size only: the bytes and the data URI itself must never
        // reach the audit row, which runs once per image per run.
        ctx.summary.bytes = data?.size ?? null

        return await encodeVisionDownload(key, { data, error })
      } catch (error) {
        console.error('[vision-image] load failed', { key, error })
        ctx.summary.error =
          error instanceof Error ? error.message : String(error)
        return null
      }
    },
    { classify: (result) => (result === null ? 'failed' : 'succeeded') },
  )
}

/**
 * Bounds one download attempt. The timeout rejects, so it escapes
 * `uploadWithRetry` rather than being retried — a stalled socket is a signal to
 * requeue the row on the next run, not to hold the phase open for three of them.
 */
async function withDownloadTimeout<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined

  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `vision image download exceeded ${DOWNLOAD_TIMEOUT_MS}ms`,
              ),
            ),
          DOWNLOAD_TIMEOUT_MS,
        )
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
