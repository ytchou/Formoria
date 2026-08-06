import type { SupabaseClient } from '@supabase/supabase-js'
import { createEdgeServiceClient } from '@/lib/supabase/edge'

export interface CrawlerHitRow {
  day: string
  crawlerName: string
  pathClass: string
  count: number
}

type CrawlerHitRecord = { day: string; crawler_name: string; path_class: string; count: number }

export async function persistCrawlerHits(rows: CrawlerHitRow[]): Promise<void> {
  if (rows.length === 0) return

  // Railway runs a single web container, so read-modify-write is acceptable here.
  const client = createEdgeServiceClient() as unknown as SupabaseClient
  const days = [...new Set(rows.map((row) => row.day))]
  const names = [...new Set(rows.map((row) => row.crawlerName))]
  const classes = [...new Set(rows.map((row) => row.pathClass))]
  const { data, error } = await client
    .from('crawler_hits')
    .select('day,crawler_name,path_class,count')
    .in('day', days)
    .in('crawler_name', names)
    .in('path_class', classes)
  if (error) throw error

  const existing = new Map(((data ?? []) as CrawlerHitRecord[]).map((row) => [`${row.day}|${row.crawler_name}|${row.path_class}`, row.count]))
  const values = rows.map((row) => ({
    day: row.day,
    crawler_name: row.crawlerName,
    path_class: row.pathClass,
    count: (existing.get(`${row.day}|${row.crawlerName}|${row.pathClass}`) ?? 0) + row.count,
  }))
  const result = await client.from('crawler_hits').upsert(values, { onConflict: 'day,crawler_name,path_class' })
  if (result.error) throw result.error
}
