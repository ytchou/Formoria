import { captureAlert } from '@/lib/adapters/alerting/sentry'

// CRAWLER_RE remains an independent witness because a verifier cannot detect
// its own transform-rule failure. A stable disagreement count should become a
// step change when the Cloudflare rule silently stops matching.
const DISAGREEMENT_WINDOW_MS = 60_000

type Disagreement = { windowStarted: number; windowCount: number; suppressedCount: number }
const disagreements = new Map<string, Disagreement>()

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

export function reportCrawlerVerificationDisagreement(input: {
  crawlerName: string | null
  userAgentClaimsCrawler: boolean
  verified: boolean
}): void {
  try {
    if (!input.userAgentClaimsCrawler || input.verified) return
    const name = input.crawlerName ?? 'unknown'
    const now = Date.now()
    const current = disagreements.get(name)
    if (current && now - current.windowStarted < DISAGREEMENT_WINDOW_MS) {
      current.windowCount += 1
      current.suppressedCount += 1
      return
    }

    const context = current
      ? { crawlerName: name, userAgentClaimsCrawler: true, verified: false, suppressedCount: current.suppressedCount, windowCount: current.windowCount }
      : { crawlerName: name, userAgentClaimsCrawler: true, verified: false, suppressedCount: 0, windowCount: 1 }
    safeCapture('Crawler verification disagreement', context, 'warning')
    disagreements.set(name, { windowStarted: now, windowCount: 1, suppressedCount: 0 })
  } catch {
    return
  }
}

export function reportCrawlerRateLimited(input: { crawlerName: string; pathname: string }): void {
  try {
    safeCapture('Registry crawler received a rate-limit response', input, 'error')
  } catch {
    return
  }
}

export function reportCrawlerChallenged(input: { crawlerName: string; pathname: string }): void {
  try {
    safeCapture('Registry crawler was challenged', input, 'error')
  } catch {
    return
  }
}

export function resetCrawlerDriftForTests(): void {
  try {
    disagreements.clear()
  } catch {
    return
  }
}
