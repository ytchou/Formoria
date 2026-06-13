import type { Database, Json } from '@/lib/supabase/database.types'

type FeedbackRow = Database['public']['Tables']['feedback']['Row']
type FeedbackInsert = Database['public']['Tables']['feedback']['Insert']
type FeedbackUpdate = Database['public']['Tables']['feedback']['Update']

export type FeedbackStatus = 'open' | 'reviewed' | 'closed'

export type FeedbackItem = {
  id: string
  source: 'sentry' | 'tally'
  type: 'bug' | 'feedback'
  title: string | null
  body: string | null
  url: string | null
  status: FeedbackStatus
  userEmail: string | null
  sentryEventId: string | null
  sentryFeedbackId: string | null
  tallyResponseId: string | null
  metadata: Record<string, unknown>
  reviewedAt: string | null
  createdAt: string
}

type SentryFeedback = {
  id: string
  eventID?: string | null
  name?: string | null
  email?: string | null
  comments?: string | null
  dateCreated: string
}

function normalizeMetadata(metadata: FeedbackRow['metadata']): Record<string, unknown> {
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    return metadata as Record<string, unknown>
  }

  return {}
}

function mapFeedbackRow(row: FeedbackRow): FeedbackItem {
  return {
    id: row.id,
    source: row.source as FeedbackItem['source'],
    type: row.type as FeedbackItem['type'],
    title: row.title,
    body: row.body,
    url: row.url,
    status: row.status as FeedbackStatus,
    userEmail: row.user_email,
    sentryEventId: row.sentry_event_id,
    sentryFeedbackId: row.sentry_feedback_id,
    tallyResponseId: row.tally_response_id,
    metadata: normalizeMetadata(row.metadata),
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
  }
}

export async function getFeedbackItems(filters?: {
  status?: FeedbackStatus
  source?: 'sentry' | 'tally'
}): Promise<FeedbackItem[]> {
  const { createServiceClient } = await import('@/lib/supabase/server')
  const supabase = createServiceClient()

  let query = supabase
    .from('feedback')
    .select('*')

  if (filters?.status) {
    query = query.eq('status', filters.status)
  }

  if (filters?.source) {
    query = query.eq('source', filters.source)
  }

  const { data, error } = await query.order('created_at', { ascending: false })

  if (error) throw error

  return ((data ?? []) as FeedbackRow[]).map(mapFeedbackRow)
}

export async function createFeedbackFromTally(input: {
  tallyResponseId: string
  type: 'bug' | 'feedback'
  title?: string
  body?: string
  url?: string
  userEmail?: string
  metadata?: Record<string, unknown>
}): Promise<void> {
  const { createServiceClient } = await import('@/lib/supabase/server')
  const supabase = createServiceClient()

  const record: FeedbackInsert = {
    source: 'tally',
    type: input.type,
    title: input.title ?? null,
    body: input.body ?? null,
    url: input.url ?? null,
    tally_response_id: input.tallyResponseId,
    user_email: input.userEmail ?? null,
    metadata: (input.metadata ?? {}) as Json,
  }

  const { error } = await supabase
    .from('feedback')
    .upsert(record, {
      onConflict: 'tally_response_id',
      ignoreDuplicates: true,
    })

  if (error) throw new Error(error.message)
}

export async function syncSentryFeedback(): Promise<{ synced: number; errors: number }> {
  const org = process.env.SENTRY_ORG
  const project = process.env.SENTRY_PROJECT
  const token = process.env.SENTRY_API_TOKEN

  const missing = [
    ['SENTRY_ORG', org],
    ['SENTRY_PROJECT', project],
    ['SENTRY_API_TOKEN', token],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name)

  if (missing.length > 0) {
    throw new Error(`Sentry not configured: missing ${missing.join(', ')}`)
  }

  const response = await fetch(
    `https://sentry.io/api/0/projects/${org}/${project}/user-feedback/?limit=100`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(10_000),
    }
  )

  if (!response.ok) {
    throw new Error(`Failed to fetch Sentry feedback: ${response.status}`)
  }

  const items = (await response.json()) as SentryFeedback[]
  const { createServiceClient } = await import('@/lib/supabase/server')
  const supabase = createServiceClient()

  const rows: FeedbackInsert[] = items.map((item) => ({
    source: 'sentry',
    type: 'bug',
    title: null,
    body: item.comments,
    status: 'open',
    user_email: item.email || null,
    sentry_event_id: item.eventID || null,
    sentry_feedback_id: item.id,
    metadata: {},
    created_at: item.dateCreated,
  }))

  const { error } = await supabase
    .from('feedback')
    .upsert(rows, { onConflict: 'sentry_feedback_id' })

  if (error) {
    return { synced: 0, errors: rows.length }
  }

  return { synced: rows.length, errors: 0 }
}

export async function updateFeedbackStatus(
  id: string,
  status: FeedbackStatus
): Promise<void> {
  const { createServiceClient } = await import('@/lib/supabase/server')
  const supabase = createServiceClient()

  const updateData: FeedbackUpdate = { status }

  if (status === 'reviewed') {
    updateData.reviewed_at = new Date().toISOString()
  }

  const { error } = await supabase
    .from('feedback')
    .update(updateData)
    .eq('id', id)

  if (error) throw error
}

export async function getFeedbackStats(): Promise<{
  open: number
  reviewed: number
  closed: number
}> {
  const { createServiceClient } = await import('@/lib/supabase/server')
  const supabase = createServiceClient()

  const [openResult, reviewedResult, closedResult] = await Promise.all([
    supabase
      .from('feedback')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'open'),
    supabase
      .from('feedback')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'reviewed'),
    supabase
      .from('feedback')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'closed'),
  ])

  if (openResult.error) throw openResult.error
  if (reviewedResult.error) throw reviewedResult.error
  if (closedResult.error) throw closedResult.error

  return {
    open: openResult.count ?? 0,
    reviewed: reviewedResult.count ?? 0,
    closed: closedResult.count ?? 0,
  }
}
