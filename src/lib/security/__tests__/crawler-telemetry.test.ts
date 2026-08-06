import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { flushCrawlerHits, recordCrawlerHit, resetCrawlerTelemetryForTests, setCrawlerHitWriterForTests, type CrawlerHitRow } from '../crawler-telemetry'

let rows: CrawlerHitRow[] = []
const request = (path: string, userAgent = 'Googlebot/2.1') => new NextRequest(`https://formoria.com${path}`, { headers: { 'user-agent': userAgent } })

// Hand-picked so every UA matches exactly one registry entry and every path maps
// to a distinct path_class. 7 x 8 = 56 distinct buffer keys, comfortably past the
// 50-row size threshold, with no dependence on registry ordering or length.
const CRAWLER_UAS = ['Googlebot/2.1', 'Bingbot/2.0', 'Applebot/0.1', 'DuckDuckBot/1.0', 'YandexBot/3.0', 'GPTBot/1.0', 'ClaudeBot/1.0']
const PATHS = ['/brands/example', '/brands', '/stories', '/events', '/sitemap.xml', '/robots.txt', '/api/status', '/about']

beforeEach(() => {
  rows = []
  setCrawlerHitWriterForTests(async (nextRows) => { rows.push(...nextRows) })
})

afterEach(() => {
  resetCrawlerTelemetryForTests()
  vi.useRealTimers()
})

describe('crawler telemetry', () => {
  it('buffers hits without writing per request', () => {
    recordCrawlerHit(request('/brands/example'))
    expect(rows).toHaveLength(0)
  })

  it('flushes when the buffer reaches its size threshold', async () => {
    let recorded = 0
    for (const userAgent of CRAWLER_UAS) {
      for (const path of PATHS) {
        if (recorded === 50) break
        recordCrawlerHit(request(path, userAgent))
        recorded += 1
      }
    }
    // No manual flush: reaching the threshold must drain the buffer on its own.
    await Promise.resolve()
    expect(rows).toHaveLength(50)
  })

  it('flushes when the buffer exceeds its age threshold', async () => {
    vi.useFakeTimers()
    recordCrawlerHit(request('/brands/example'))
    expect(rows).toHaveLength(0)
    vi.advanceTimersByTime(60_001)
    // The next hit observes the stale buffer and drains it — no manual flush.
    recordCrawlerHit(request('/stories'))
    await Promise.resolve()
    expect(rows).toHaveLength(2)
  })

  it('aggregates repeat hits into a single counted row', async () => {
    recordCrawlerHit(request('/brands/example'))
    recordCrawlerHit(request('/brands/another'))
    await flushCrawlerHits()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.count).toBe(2)
  })

  it('a flush failure does not throw into the request path', async () => {
    setCrawlerHitWriterForTests(async () => { throw new Error('database unavailable') })
    recordCrawlerHit(request('/brands/example'))
    await expect(flushCrawlerHits()).resolves.toBeUndefined()
  })
})
