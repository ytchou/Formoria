import { captureAlert } from '@/lib/adapters/alerting/sentry'
import { hasObservedVerifiedHeader } from './verified-crawler'

// CRAWLER_RE remains an independent witness because a verifier cannot detect
// its own transform-rule failure. A stable disagreement count should become a
// step change when the Cloudflare rule silently stops matching.
const ALARM_WINDOW_MS = 60_000

type AlarmWindow = { windowStarted: number; windowCount: number }

// One window map for every alarm in this module. Any of these can be driven by
// an anonymous client (a spoofed `User-Agent: Googlebot` against /api/* is
// enough), so an unwindowed `level: 'error'` capture is a per-request Sentry
// event -- tens of thousands an hour at modest request rates.
const windows = new Map<string, AlarmWindow>()

// Disagreement counting is kept even while the alert is withheld: the plan wants
// the disagreement RATE, which is the witness that detects the Cloudflare
// transform rule breaking after it ships.
const disagreementTotals = new Map<string, number>()

/**
 * The single load-bearing guard for this module: emission must never throw into
 * the request path. Everything above this call is map arithmetic that cannot
 * throw, so no caller needs its own try/catch.
 */
function safeCapture(message: string, context: Record<string, string | number | boolean | null>, level: 'error' | 'warning'): void {
  try {
    const result: unknown = captureAlert(message, { level, context })
    if (typeof result === 'object' && result !== null && 'then' in result) {
      void Promise.resolve(result).catch(() => {})
    }
  } catch {
    return
  }
}

/**
 * Per-key 60s suppression. Returns the count to report when this call should
 * emit (the closed window's total, so the emitted event carries how many events
 * it stands for), or null when the call falls inside an open window.
 */
function takeAlarmWindow(key: string): { windowCount: number } | null {
  const now = Date.now()
  const current = windows.get(key)
  if (current && now - current.windowStarted < ALARM_WINDOW_MS) {
    current.windowCount += 1
    return null
  }

  windows.set(key, { windowStarted: now, windowCount: 1 })
  return { windowCount: current ? current.windowCount : 1 }
}

export function reportCrawlerVerificationDisagreement(input: {
  crawlerName: string | null
  userAgentClaimsCrawler: boolean
  verified: boolean
}): void {
  if (!input.userAgentClaimsCrawler || input.verified) return
  const name = input.crawlerName ?? 'unknown'
  disagreementTotals.set(name, (disagreementTotals.get(name) ?? 0) + 1)

  // The Cloudflare transform rule that sets `x-formoria-verified-bot` is
  // deferred to a follow-up PR, so at this revision `verified` is false for
  // EVERY request and this alarm would describe a condition the team already
  // knows is true -- roughly 14k Sentry events a day, indefinitely. The gate is
  // the observation latch rather than an env flag so it needs no deploy to
  // clear: the first verified request the origin ever sees arms the alarm, and
  // from then on a disagreement is real news. Counting above is unconditional.
  if (!hasObservedVerifiedHeader()) return

  const window = takeAlarmWindow(`disagreement:${name}`)
  if (!window) return

  safeCapture(
    'Crawler verification disagreement',
    {
      crawlerName: name,
      userAgentClaimsCrawler: true,
      verified: false,
      suppressedCount: window.windowCount - 1,
      windowCount: window.windowCount,
    },
    'warning',
  )
}

export function reportCrawlerRateLimited(input: { crawlerName: string; pathname: string }): void {
  const window = takeAlarmWindow(`rate-limited:${input.crawlerName}`)
  if (!window) return
  safeCapture(
    'Registry crawler received a rate-limit response',
    { ...input, suppressedCount: window.windowCount - 1, windowCount: window.windowCount },
    'error',
  )
}

export function reportCrawlerChallenged(input: { crawlerName: string; pathname: string }): void {
  const window = takeAlarmWindow(`challenged:${input.crawlerName}`)
  if (!window) return
  safeCapture(
    'Registry crawler was challenged',
    { ...input, suppressedCount: window.windowCount - 1, windowCount: window.windowCount },
    'error',
  )
}

/** Observed disagreements per crawler name, including alerts that were withheld. */
export function getCrawlerDisagreementCount(crawlerName: string): number {
  return disagreementTotals.get(crawlerName) ?? 0
}

export function resetCrawlerDriftForTests(): void {
  windows.clear()
  disagreementTotals.clear()
}
