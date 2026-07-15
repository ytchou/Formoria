import { uploadPrivateFile } from './image-upload'
import { createServiceClient } from '@/lib/supabase/server'

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

export async function getRunLogSnapshotUrl(jobId: string): Promise<string | null> {
  const supabase = createServiceClient()
  const { data, error } = await supabase.storage
    .from(RUN_LOGS_BUCKET)
    .createSignedUrl(snapshotPath(jobId), SIGNED_URL_EXPIRES_IN_SECONDS)

  if (error) {
    const statusCode = 'statusCode' in error ? String(error.statusCode) : ''
    if (statusCode === '404' || /not found/i.test(error.message)) return null
    throw error
  }

  return data?.signedUrl ?? null
}
