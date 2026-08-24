import { createServiceClient } from '@/lib/supabase/service'
import { uploadWithRetry } from '../storage-retry'

/**
 * The one place in the codebase that calls Supabase Storage `createSignedUrls`
 * (DEV-1551, task 10).
 *
 * Three call sites used to hand-roll the same build-paths -> sign -> zip-by-index
 * block. All three shared the same two defects: they swallowed the storage
 * error and returned unsigned objects (an admin saw an empty gallery with no
 * clue why), and none of them chunked, so a page holding more than 100 paths
 * silently signed nothing at all — Supabase caps a batch at 100.
 */

/** Supabase Storage refuses a batch larger than this. */
export const SIGNED_URL_BATCH_LIMIT = 100

type SupabaseSignedUrlItem = {
  path?: string | null
  signedUrl?: string | null
  error?: string | null
}

/**
 * The seam. Production passes `bucketSigner(...)`; tests pass a plain function,
 * because mocking `@supabase/…` is forbidden by
 * `scripts/check-test-boundaries.mjs`.
 */
export type CreateSignedUrlsFn = (
  paths: string[],
) => Promise<{
  data: SupabaseSignedUrlItem[] | null
  error: { message: string } | null
}>

/**
 * The echoed label, trimmed of a leading slash. Supabase has echoed both the
 * bare key and a bucket-prefixed form across versions, so the suffix comparison
 * in {@link labelMatches} does the rest.
 */
function normalizeEchoedLabel(label: string | null | undefined): string | null {
  const value = label?.trim().replace(/^\/+/, '')
  return value ? value : null
}

/** `brands/a.webp` matches both `brands/a.webp` and `brand-images/brands/a.webp`. */
function labelMatches(label: string, requestedPath: string): boolean {
  return label === requestedPath || label.endsWith(`/${requestedPath}`)
}

export class SignedUrlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SignedUrlError'
  }
}

export type SignedUrlBatchResult = {
  /** Index-for-index with the paths that were passed in, duplicates included. */
  urls: (string | null)[]
  /** Convenience lookup for the callers that project by path rather than position. */
  byPath: Map<string, string>
  /**
   * Paths the storage API rejected individually (a missing object, typically).
   * Never silent: the caller decides between omitting one image and failing the
   * whole projection, but it cannot fail to notice.
   */
  failures: { path: string; message: string }[]
}

/**
 * Signs every path, in batches of {@link SIGNED_URL_BATCH_LIMIT}.
 *
 * A batch-level error THROWS — that is the storage API being unavailable or the
 * bucket being wrong, which is never something to paper over with an unsigned
 * object. A single path failing inside an otherwise good batch is reported in
 * `failures` instead, so one deleted object cannot blank an entire admin page.
 *
 * Results are matched to requests by the LABEL Supabase echoes in `item.path`,
 * not by position. Zipping by index is only correct while the response happens
 * to be in request order; one reordered or omitted entry would otherwise serve
 * one submission's signed pre-moderation image under another submission's key,
 * silently and with `failures` empty. A requested path with no matching label
 * becomes a failure. Index zipping survives only as the fallback for a response
 * that echoes no label at all.
 */
export async function createSignedUrlsInBatches(
  paths: readonly string[],
  createSignedUrls: CreateSignedUrlsFn,
): Promise<SignedUrlBatchResult> {
  const byPath = new Map<string, string>()
  const failures: { path: string; message: string }[] = []

  const uniquePaths = [...new Set(paths.filter((path) => Boolean(path)))]

  for (let index = 0; index < uniquePaths.length; index += SIGNED_URL_BATCH_LIMIT) {
    const batch = uniquePaths.slice(index, index + SIGNED_URL_BATCH_LIMIT)
    const { data, error } = await createSignedUrls(batch)

    if (error) {
      throw new SignedUrlError(
        `Failed to sign ${batch.length} storage path(s): ${error.message}`,
      )
    }

    if (!data) {
      throw new SignedUrlError(
        `Storage returned no result for ${batch.length} path(s)`,
      )
    }

    const labelled = data.map((item) => ({
      item,
      label: normalizeEchoedLabel(item?.path),
    }))
    const anyLabelled = labelled.some((entry) => entry.label !== null)

    batch.forEach((path, batchIndex) => {
      // `item.path` is echoed back by Supabase; when present it is the
      // authoritative label for the row, so it decides the pairing. Only a
      // response that labels nothing falls back to position.
      const item = anyLabelled
        ? labelled.find(
            (entry) => entry.label !== null && labelMatches(entry.label, path),
          )?.item
        : data[batchIndex]

      if (!item) {
        failures.push({
          path,
          message: anyLabelled
            ? 'storage response carried no entry labelled with this path'
            : 'no signed url returned',
        })
        return
      }
      if (item.error || !item.signedUrl) {
        failures.push({
          path,
          message: item.error ?? 'no signed url returned',
        })
        return
      }
      byPath.set(path, item.signedUrl)
    })
  }

  return {
    urls: paths.map((path) => byPath.get(path) ?? null),
    byPath,
    failures,
  }
}

/**
 * Production wiring for {@link createSignedUrlsInBatches}. Kept separate so
 * that nothing but this module constructs a storage client for signing.
 */
export function bucketSigner(
  bucket: string,
  expiresInSeconds: number,
): CreateSignedUrlsFn {
  return (batch) =>
    uploadWithRetry(() =>
      createServiceClient().storage.from(bucket).createSignedUrls(batch, expiresInSeconds),
    )
}
