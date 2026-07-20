import { createServiceClient } from '@/lib/supabase/server'

export type MarketingCalendarItem = {
  id: string
  title: string
  type: string
  status: string
  priority: string
  targetDate: string | null
  platforms: string[]
  media: string | null
  lang: string
  sourceType: string | null
  sourceDetectedBy: string | null
  sourceDetectedAt: string | null
  sourceUrl: string | null
  briefPath: string | null
  outputPath: string | null
  todoistTaskId: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
}

type MarketingCalendarRow = {
  id: string
  title: string
  type: string
  status: string
  priority: string
  target_date: string | null
  platforms: string[]
  media: string | null
  lang: string
  source_type: string | null
  source_detected_by: string | null
  source_detected_at: string | null
  source_url: string | null
  brief_path: string | null
  output_path: string | null
  todoist_task_id: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export type CreateMarketingItemInput = Pick<
  MarketingCalendarItem,
  'id' | 'title' | 'type'
> & Partial<Omit<MarketingCalendarItem, 'id' | 'title' | 'type'>>

function toMarketingCalendarRow(
  item: Partial<MarketingCalendarItem>
): Partial<MarketingCalendarRow> {
  const row: Partial<MarketingCalendarRow> = {}

  if (item.id !== undefined) row.id = item.id
  if (item.title !== undefined) row.title = item.title
  if (item.type !== undefined) row.type = item.type
  if (item.status !== undefined) row.status = item.status
  if (item.priority !== undefined) row.priority = item.priority
  if (item.targetDate !== undefined) row.target_date = item.targetDate
  if (item.platforms !== undefined) row.platforms = item.platforms
  if (item.media !== undefined) row.media = item.media
  if (item.lang !== undefined) row.lang = item.lang
  if (item.sourceType !== undefined) row.source_type = item.sourceType
  if (item.sourceDetectedBy !== undefined) row.source_detected_by = item.sourceDetectedBy
  if (item.sourceDetectedAt !== undefined) row.source_detected_at = item.sourceDetectedAt
  if (item.sourceUrl !== undefined) row.source_url = item.sourceUrl
  if (item.briefPath !== undefined) row.brief_path = item.briefPath
  if (item.outputPath !== undefined) row.output_path = item.outputPath
  if (item.todoistTaskId !== undefined) row.todoist_task_id = item.todoistTaskId
  if (item.notes !== undefined) row.notes = item.notes
  if (item.createdAt !== undefined) row.created_at = item.createdAt
  if (item.updatedAt !== undefined) row.updated_at = item.updatedAt

  return row
}

function toMarketingCalendarItem(row: MarketingCalendarRow): MarketingCalendarItem {
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    status: row.status,
    priority: row.priority,
    targetDate: row.target_date,
    platforms: row.platforms,
    media: row.media,
    lang: row.lang,
    sourceType: row.source_type,
    sourceDetectedBy: row.source_detected_by,
    sourceDetectedAt: row.source_detected_at,
    sourceUrl: row.source_url,
    briefPath: row.brief_path,
    outputPath: row.output_path,
    todoistTaskId: row.todoist_task_id,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function listMarketingItems(): Promise<MarketingCalendarItem[]> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('marketing_calendar')
    .select('*')
    .order('target_date', { ascending: true, nullsFirst: false })

  if (error) throw error

  return ((data ?? []) as MarketingCalendarRow[]).map(toMarketingCalendarItem)
}

export async function createMarketingItem(
  input: CreateMarketingItemInput
): Promise<MarketingCalendarItem> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('marketing_calendar')
    .insert(toMarketingCalendarRow(input))
    .select('*')
    .single()

  if (error) throw error

  return toMarketingCalendarItem(data as MarketingCalendarRow)
}

export async function updateMarketingItem(
  id: string,
  patch: Partial<MarketingCalendarItem>
): Promise<MarketingCalendarItem | null> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('marketing_calendar')
    .update({
      ...toMarketingCalendarRow(patch),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .maybeSingle()

  if (error) throw error

  return data ? toMarketingCalendarItem(data as MarketingCalendarRow) : null
}

export async function deleteMarketingItem(id: string): Promise<{ deleted: boolean }> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('marketing_calendar')
    .delete()
    .eq('id', id)
    .select('id')
    .maybeSingle()

  if (error) throw error

  return { deleted: data !== null }
}
