import sharp from 'sharp'
import { createServiceClient } from '@/lib/supabase/service'
import { storageKeyFromPublicUrl } from './image-upload'
import { uploadWithRetry } from './storage-retry'

const BRAND_IMAGES_BUCKET = 'brand-images'

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
 * 512 is the largest width that carries any information to the model. Quality
 * 80 (the harness value) rather than the render endpoint's old 70: we now do
 * the only encode, so there is no second lossy pass to budget for.
 */
export const VISION_IMAGE_WIDTH = 512
export const VISION_IMAGE_QUALITY = 80

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
 * Storage read + encode. Returns null on ANY failure — never throws.
 *
 * A null here must stay a *transient* signal: the caller leaves the row
 * untouched so the next run re-queues it. That property is what DEV-1255 lost
 * when a fetch failure was written as a verdict, and it is now enforced at this
 * boundary rather than by a retry loop downstream.
 *
 * Reads through `.download()` on the service client rather than fetching the
 * public URL. Egress bills the same either way — only the *transformation* is
 * separately metered — and a bare `fetch` under `src/` would have to be
 * allowlisted past `check:audited-external-calls`.
 *
 * The service client is constructed here, not at module scope, so importing the
 * pure encoder above cannot pull a write-capable client into `scripts/model-ab/`.
 */
export async function loadVisionDataUri(image: {
  storage_path?: string | null
  url: string
}): Promise<string | null> {
  const key = image.storage_path?.trim() || storageKeyFromPublicUrl(image.url)
  // An external/legacy hotlink has no object to download. Treat it as a load
  // failure so the row is skipped rather than judged on an image we never sent.
  if (!key) return null

  try {
    const supabase = createServiceClient()
    const { data, error } = await uploadWithRetry(() =>
      supabase.storage.from(BRAND_IMAGES_BUCKET).download(key),
    )
    if (error || !data) return null

    return await visionDataUri(Buffer.from(await data.arrayBuffer()))
  } catch {
    return null
  }
}
