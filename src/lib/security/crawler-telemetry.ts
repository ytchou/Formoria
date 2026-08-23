import { after } from 'next/server'
import { matchCrawler } from './crawler-registry'
import { isoDateInTimeZone } from '@/lib/date-range'
import { persistCrawlerHits, type CrawlerHitRow } from '@/lib/services/crawler-hits-edge'

export type { CrawlerHitRow }

const MAX_BUFFERED_ROWS = 50
const MAX_BUFFER_AGE_MS = 60_000
// Every analytics read surface in this project buckets by Asia/Taipei
// (see date-range.ts), so the write side matches it: a UTC `day` here would put
// the 00:00-08:00 Taipei slice of crawler traffic on the previous row and
// quietly disagree with every report reading it.
const TELEMETRY_TIME_ZONE = 'Asia/Taipei'
const buffered = new Map<string, CrawlerHitRow>()
let oldestHitAt: number | null = null
let flushTimer: ReturnType<typeof setTimeout> | null = null
let flushScheduled = false
let writer: (rows: CrawlerHitRow[]) => Promise<void> = persistCrawlerHits

function pathClass(pathname: string): string {
  const segments = pathname.split('/').filter(Boolean)
  const withoutLocale = segments[0] === 'en' || segments[0] === 'zh-TW' ? segments.slice(1) : segments
  const first = withoutLocale[0]
  if (first === 'brands') return withoutLocale.length > 1 ? 'brands-detail' : 'brands-index'
  if (first === 'stories') return 'stories'
  if (first === 'events') return 'events'
  if (first === 'sitemap.xml') return 'sitemap'
  if (first === 'robots.txt') return 'robots'
  if (first === 'api') return 'api'
  return 'other'
}

function dayAt(timestamp: number): string {
  return isoDateInTimeZone(new Date(timestamp).toISOString(), TELEMETRY_TIME_ZONE)
}

function scheduleFlush(): void {
  // In-flight guard: without it a burst registers one `after()` callback per
  // request while a flush is already pending.
  if (flushScheduled) return
  flushScheduled = true

  try {
    after(() => flushCrawlerHits())
    return
  } catch {
    // `after()` needs a request scope. Outside one (unit tests, or any future
    // non-request caller) fall back to a fire-and-forget flush so the buffer
    // still drains and no request ever waits on the write.
  }
  void flushCrawlerHits().catch(() => {})
}

/**
 * The size/age conditions are only evaluated by an incoming hit, so a burst
 * followed by silence would sit in module memory until the container restarts
 * and then be discarded. The timer makes the buffer drain on its own.
 */
function armFlushTimer(): void {
  if (flushTimer) return
  try {
    flushTimer = setTimeout(() => {
      flushTimer = null
      void flushCrawlerHits().catch(() => {})
    }, MAX_BUFFER_AGE_MS)
    // Telemetry must never hold the process open. Not available on the DOM
    // timer type, hence the optional call.
    ;(flushTimer as unknown as { unref?: () => void }).unref?.()
  } catch {
    // A runtime without timers is not a reason to fail a request; the size/age
    // conditions still drain the buffer whenever the next hit arrives.
    flushTimer = null
  }
}

function clearFlushTimer(): void {
  if (!flushTimer) return
  clearTimeout(flushTimer)
  flushTimer = null
}

export function recordCrawlerHit(request: { headers: { get(name: string): string | null }; nextUrl: { pathname: string } }): void {
  try {
    const entry = matchCrawler(request.headers.get('user-agent') ?? '')
    if (!entry) return

    const now = Date.now()
    const day = dayAt(now)
    const pathClassValue = pathClass(request.nextUrl.pathname)
    const key = `${day}|${entry.name}|${pathClassValue}`
    const current = buffered.get(key)
    if (current) current.count += 1
    else buffered.set(key, { day, crawlerName: entry.name, pathClass: pathClassValue, count: 1 })
    if (oldestHitAt === null) {
      oldestHitAt = now
      armFlushTimer()
    }

    if (buffered.size >= MAX_BUFFERED_ROWS || now - oldestHitAt >= MAX_BUFFER_AGE_MS) scheduleFlush()
  } catch {
    return
  }
}

export async function flushCrawlerHits(): Promise<void> {
  clearFlushTimer()
  flushScheduled = false
  if (buffered.size === 0) return
  const rows = [...buffered.values()]
  buffered.clear()
  oldestHitAt = null
  try {
    await writer(rows)
  } catch (error) {
    // These rows are telemetry, not audit data; dropping a failed flush keeps
    // database trouble from affecting the request path.
    console.warn('[crawler-telemetry] failed to persist crawler hits', error)
  }
}

export function setCrawlerHitWriterForTests(fn: (rows: CrawlerHitRow[]) => Promise<void>): void {
  writer = fn
}

export function resetCrawlerTelemetryForTests(): void {
  clearFlushTimer()
  flushScheduled = false
  buffered.clear()
  oldestHitAt = null
  writer = persistCrawlerHits
}
