import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CRAWLER_HITS_RPC,
  persistCrawlerHits,
  resetCrawlerHitsClientForTests,
  setCrawlerHitsClientForTests,
  type CrawlerHitsClient,
} from '../crawler-hits-edge'

/**
 * The buffer tests stub `persistCrawlerHits` wholesale, so without this suite
 * the RPC name and the snake_case payload keys are never executed by anything
 * -- and a typo would ship green, surface only as a swallowed console.warn, and
 * leave crawler_hits silently empty in production.
 *
 * The stub goes in through `setCrawlerHitsClientForTests`, the same injection
 * seam `crawler-telemetry.ts` uses for its writer; mocking `@/lib/supabase/edge`
 * is rejected by `scripts/check-test-boundaries.mjs`.
 */
type RpcResult = { error: { message: string } | null }
const rpc = vi.fn<(name: string, args: unknown) => Promise<RpcResult>>(async () => ({ error: null }))

beforeEach(() => {
  rpc.mockClear()
  rpc.mockImplementation(async () => ({ error: null }))
  setCrawlerHitsClientForTests({ rpc } as unknown as CrawlerHitsClient)
})

afterEach(() => {
  resetCrawlerHitsClientForTests()
})

describe('persistCrawlerHits', () => {
  it('does not call the database for an empty batch', async () => {
    await persistCrawlerHits([])
    expect(rpc).not.toHaveBeenCalled()
  })

  it('calls the atomic increment function with snake_case column names', async () => {
    await persistCrawlerHits([{ day: '2026-08-07', crawlerName: 'Googlebot', pathClass: 'brands-detail', count: 3 }])

    expect(rpc).toHaveBeenCalledWith(CRAWLER_HITS_RPC, {
      p_rows: [{ day: '2026-08-07', crawler_name: 'Googlebot', path_class: 'brands-detail', count: 3 }],
    })
    expect(CRAWLER_HITS_RPC).toBe('increment_crawler_hits')
  })

  it('sends one row per (day, crawler_name, path_class) key so the upsert conflict target cannot double-hit', async () => {
    await persistCrawlerHits([
      { day: '2026-08-07', crawlerName: 'Googlebot', pathClass: 'brands-detail', count: 3 },
      { day: '2026-08-07', crawlerName: 'Googlebot', pathClass: 'brands-detail', count: 4 },
      { day: '2026-08-07', crawlerName: 'Googlebot', pathClass: 'brands-index', count: 1 },
      { day: '2026-08-08', crawlerName: 'Googlebot', pathClass: 'brands-detail', count: 2 },
      { day: '2026-08-07', crawlerName: 'Bingbot', pathClass: 'brands-detail', count: 5 },
    ])

    const payload = rpc.mock.calls[0]?.[1] as unknown as { p_rows: Array<Record<string, unknown>> }
    expect(payload.p_rows).toHaveLength(4)
    expect(payload.p_rows[0]).toEqual({ day: '2026-08-07', crawler_name: 'Googlebot', path_class: 'brands-detail', count: 7 })
    expect(new Set(payload.p_rows.map((row) => `${row.day}|${row.crawler_name}|${row.path_class}`)).size).toBe(4)
  })

  it('sends a delta, never an absolute total — the add happens in Postgres', async () => {
    await persistCrawlerHits([{ day: '2026-08-07', crawlerName: 'Googlebot', pathClass: 'api', count: 2 }])
    // A read-modify-write implementation would have had to SELECT first.
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('surfaces a database error so the caller can log and drop the batch', async () => {
    rpc.mockImplementation(async () => ({ error: { message: 'relation "crawler_hits" does not exist' } }))
    await expect(
      persistCrawlerHits([{ day: '2026-08-07', crawlerName: 'Googlebot', pathClass: 'api', count: 1 }]),
    ).rejects.toBeTruthy()
  })
})
