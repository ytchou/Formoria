import sharp from 'sharp'
import { storageKeyFromPublicUrlForRead } from './image-upload'

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
 * transformation counter goes structurally to zero. The since-retired model
 * A/B eval harness — ground truth for classifier quality — always worked this
 * way; this module is that code promoted into production so both sides encode
 * the identical picture.
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
 * because the model A/B eval harness — which held the original fetched bytes
 * and genuinely did encode once — set the baseline every verdict is compared
 * against; moving this number off the harness value would break that
 * comparability for a saving the model cannot see. The generation loss is the
 * accepted cost of parity.
 */
export const VISION_IMAGE_WIDTH = 512
const VISION_IMAGE_QUALITY = 80

/**
 * Pure: bytes -> 512px webp data URI. No I/O, no Supabase client, so an eval
 * harness can import it without dragging a service-role client into code that
 * deliberately runs on a write-blocking client.
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
