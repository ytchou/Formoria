import { after } from 'next/server'
import { matchCrawler } from './crawler-registry'
import { persistCrawlerHits, type CrawlerHitRow } from '@/lib/services/crawler-hits-edge'

export type { CrawlerHitRow }

const MAX_BUFFERED_ROWS = 50
const MAX_BUFFER_AGE_MS = 60_000
const buffered = new Map<string, CrawlerHitRow>()
let oldestHitAt: number | null = null
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
  return new Date(timestamp).toISOString().slice(0, 10)
}

function scheduleFlush(): void {
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
    oldestHitAt ??= now

    if (buffered.size >= MAX_BUFFERED_ROWS || now - oldestHitAt >= MAX_BUFFER_AGE_MS) scheduleFlush()
  } catch {
    return
  }
}

export async function flushCrawlerHits(): Promise<void> {
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
  buffered.clear()
  oldestHitAt = null
  writer = persistCrawlerHits
}
