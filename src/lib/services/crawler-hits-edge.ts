import type { SupabaseClient } from '@supabase/supabase-js'
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
export type CrawlerHitsClient = Pick<SupabaseClient, 'rpc'>

// Ceiling: `crawler_hits` is absent from database.types.ts because its
// migration is deliberately unapplied, so the generated Database type has no
// entry for this RPC and the call has to be made through an untyped client --
// renaming a column or the function keeps `tsc` green. The repository-adapter
// pattern used by brand-redirects-edge.ts does not remove this: an adapter
// would need the same cast, just one file further away.
// Upgrade path: once the migration is applied and database.types.ts is
// regenerated, drop the cast and let `client.rpc` type-check the payload,
// then delete this comment.
const defaultClientFactory = (): CrawlerHitsClient =>
  createEdgeServiceClient() as unknown as SupabaseClient

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
