import { uploadPrivateFile } from './image-upload'
import { bucketSigner, createSignedUrlsInBatches } from './_shared/signed-urls'

const RUN_LOGS_BUCKET = 'run-logs'
const SIGNED_URL_EXPIRES_IN_SECONDS = 60 * 60

function snapshotPath(jobId: string): string {
  return `${jobId}.html`
}

export async function uploadRunLogSnapshot(jobId: string, html: string): Promise<void> {
  await uploadPrivateFile({
    bucket: RUN_LOGS_BUCKET,
    path: snapshotPath(jobId),
    data: Buffer.from(html),
    contentType: 'text/html; charset=utf-8',
    upsert: true,
  })
}

/**
 * Null when the snapshot does not exist (a job that never wrote one), and a
 * throw when signing itself fails. Routed through the shared batch signer so
 * that `createSignedUrls` has exactly one call site: a missing object comes
 * back as a per-path failure, a broken bucket as a `SignedUrlError`.
 */
export async function getRunLogSnapshotUrl(jobId: string): Promise<string | null> {
  const { urls } = await createSignedUrlsInBatches(
    [snapshotPath(jobId)],
    bucketSigner(RUN_LOGS_BUCKET, SIGNED_URL_EXPIRES_IN_SECONDS),
  )

  return urls[0] ?? null
}
