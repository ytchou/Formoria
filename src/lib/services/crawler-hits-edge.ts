import { createEdgeServiceClient } from '@/lib/supabase/edge'

export interface CrawlerHitRow {
  day: string
  crawlerName: string
  pathClass: string
  count: number
}

export const CRAWLER_HITS_RPC = 'increment_crawler_hits'

type CrawlerHitRecord = { day: string; crawler_name: string; path_class: string; count: number }

/** snake_case at the service boundary, matching the crawler_hits columns. */
function toRecords(rows: CrawlerHitRow[]): CrawlerHitRecord[] {
  const merged = new Map<string, CrawlerHitRecord>()
  for (const row of rows) {
    const key = `${row.day}|${row.crawlerName}|${row.pathClass}`
    const existing = merged.get(key)
    if (existing) existing.count += row.count
    else merged.set(key, { day: row.day, crawler_name: row.crawlerName, path_class: row.pathClass, count: row.count })
  }
  return [...merged.values()]
}

/**
 * Client seam, mirroring `setCrawlerHitWriterForTests` in crawler-telemetry.ts:
 * tests inject a stub through the seam instead of mocking `@/lib/supabase/edge`,
 * which the test-boundary check forbids.
 */
// Derived from the factory's return type rather than a bare SupabaseClient, so
// the seam carries the generated Database types and a renamed column or RPC
// fails `tsc` instead of surfacing as a swallowed runtime warning.
export type CrawlerHitsClient = Pick<ReturnType<typeof createEdgeServiceClient>, 'rpc'>

const defaultClientFactory = (): CrawlerHitsClient => createEdgeServiceClient()

let clientFactory: () => CrawlerHitsClient = defaultClientFactory

export function setCrawlerHitsClientForTests(client: CrawlerHitsClient): void {
  clientFactory = () => client
}

export function resetCrawlerHitsClientForTests(): void {
  clientFactory = defaultClientFactory
}

export async function persistCrawlerHits(rows: CrawlerHitRow[]): Promise<void> {
  if (rows.length === 0) return

  const client = clientFactory()

  // The increment is done in Postgres (`count = crawler_hits.count + excluded.count`).
  // Read-modify-write here would lose increments: `flushCrawlerHits` clears the
  // buffer before awaiting the write, so two `after()` flushes routinely overlap
  // inside the single Railway container.
  const { error } = await client.rpc(CRAWLER_HITS_RPC, { p_rows: toRecords(rows) })
  if (error) throw error
}
