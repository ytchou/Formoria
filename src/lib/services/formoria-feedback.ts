import { createServiceClient } from '@/lib/supabase/server'

type FormoriaFeedbackItem = {
  source: 'tally' | 'sentry'
  externalId: string
  title: string
  category: string
  summary: string
  createdAt: string
  sourceUrl: string
}

export type FormoriaFeedbackSnapshotV1 = {
  schemaVersion: 1
  generatedAt: string
  items: FormoriaFeedbackItem[]
}

type FeedbackRow = {
  id: string
  source: string
  title: string | null
  type: string
  body: string | null
  created_at: string
  url: string | null
  tally_response_id: string | null
  sentry_feedback_id: string | null
}

export async function getFormoriaFeedbackSnapshot(): Promise<FormoriaFeedbackSnapshotV1> {
  const result = await createServiceClient()
    .from('feedback')
    .select('id, source, title, type, body, created_at, url, tally_response_id, sentry_feedback_id')
    .order('created_at', { ascending: false })
    .limit(100)

  if (result.error) throw new Error(result.error.message)

  const items = (result.data as FeedbackRow[])
    .filter((row) => row.source === 'tally' || row.source === 'sentry')
    .map((row): FormoriaFeedbackItem => ({
      source: row.source as 'tally' | 'sentry',
      externalId: row.source === 'tally'
        ? row.tally_response_id ?? row.id
        : row.sentry_feedback_id ?? row.id,
      title: row.title ?? 'Untitled feedback',
      category: row.type,
      summary: row.body ?? 'Open Formoria for details.',
      createdAt: row.created_at,
      sourceUrl: row.url ?? 'https://formoria.com/admin',
    }))

  return { schemaVersion: 1, generatedAt: new Date().toISOString(), items }
}
