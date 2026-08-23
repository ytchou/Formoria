import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { flushCrawlerHits, recordCrawlerHit, resetCrawlerTelemetryForTests, setCrawlerHitWriterForTests, type CrawlerHitRow } from '../crawler-telemetry'

let rows: CrawlerHitRow[] = []
let writeCount = 0
const request = (path: string, userAgent = 'Googlebot/2.1') => new NextRequest(`https://formoria.com${path}`, { headers: { 'user-agent': userAgent } })

// Hand-picked so every UA matches exactly one registry entry and every path maps
// to a distinct path_class. 7 x 8 = 56 distinct buffer keys, comfortably past the
// 50-row size threshold, with no dependence on registry ordering or length.
const CRAWLER_UAS = ['Googlebot/2.1', 'Bingbot/2.0', 'Applebot/0.1', 'DuckDuckBot/1.0', 'YandexBot/3.0', 'GPTBot/1.0', 'ClaudeBot/1.0']
const PATHS = ['/brands/example', '/brands', '/stories', '/events', '/sitemap.xml', '/robots.txt', '/api/status', '/about']

beforeEach(() => {
  rows = []
  writeCount = 0
  setCrawlerHitWriterForTests(async (nextRows) => { writeCount += 1; rows.push(...nextRows) })
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

  it('drains on its own with no subsequent hit', async () => {
    vi.useFakeTimers()
    recordCrawlerHit(request('/brands/example'))
    expect(rows).toHaveLength(0)
    // Nothing else touches the module: the armed timer is the only thing that
    // can drain a burst followed by silence.
    await vi.advanceTimersByTimeAsync(60_001)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.count).toBe(1)
  })

  it('re-arms the timer for the next buffering window', async () => {
    vi.useFakeTimers()
    recordCrawlerHit(request('/brands/example'))
    await vi.advanceTimersByTimeAsync(60_001)
    expect(rows).toHaveLength(1)

    recordCrawlerHit(request('/stories'))
    await vi.advanceTimersByTimeAsync(60_001)
    expect(rows).toHaveLength(2)
  })

  it('does not register a redundant flush per request during a burst', async () => {
    vi.useFakeTimers()
    recordCrawlerHit(request('/brands/example'))
    await vi.advanceTimersByTimeAsync(60_001)
    expect(writeCount).toBe(1)

    // A burst inside one buffering window is a single write, not one per request.
    for (let i = 0; i < 40; i += 1) recordCrawlerHit(request('/stories'))
    await Promise.resolve()
    expect(writeCount).toBe(1)

    await vi.advanceTimersByTimeAsync(60_001)
    expect(writeCount).toBe(2)
    expect(rows).toHaveLength(2)
    expect(rows[1]?.count).toBe(40)
  })

  it('aggregates repeat hits into a single counted row', async () => {
    recordCrawlerHit(request('/brands/example'))
    recordCrawlerHit(request('/brands/another'))
    await flushCrawlerHits()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.count).toBe(2)
  })

  it('buckets the day in Asia/Taipei, not UTC', async () => {
    vi.useFakeTimers()
    // 2026-08-07T17:30Z is already 2026-08-08 in Taipei.
    vi.setSystemTime(new Date('2026-08-07T17:30:00Z'))
    recordCrawlerHit(request('/brands/example'))
    await flushCrawlerHits()
    expect(rows[0]?.day).toBe('2026-08-08')
  })

  it('a flush failure does not throw into the request path', async () => {
    setCrawlerHitWriterForTests(async () => { throw new Error('database unavailable') })
    recordCrawlerHit(request('/brands/example'))
    await expect(flushCrawlerHits()).resolves.toBeUndefined()
  })
})
