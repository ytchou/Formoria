/**
 * Shared URL checker for the weekly link-check classes.
 *
 * HEAD first, GET retry on 402/404/405/410/501 — same rule as
 * `src/lib/services/link-health.ts:133` (RETRY_ON). A browser user-agent
 * avoids bot-detection 403s on most origins.
 *
 * Every outbound call is wrapped in `auditedCall` so the request, outcome,
 * and latency land in `external_call_audit`.
 */

import { auditedCall } from '@/lib/audit'
import { isPrivateUrl } from '@/lib/url'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

export const TIMEOUT_MS = 10_000

/**
 * HTTP statuses that a HEAD response may not decide on its own — re-checked
 * with GET before the URL is called broken. Mirrors the RETRY_ON set in
 * `link-health.ts:133`.
 */
export const RETRY_ON = new Set([402, 404, 405, 410, 501])

/**
 * Statuses that indicate a bot challenge or rate limit, never a dead link.
 * A Cloudflare-fronted origin answers a scripted HEAD with 403, and a rate
 * limiter answers 429; both serve the page to a real visitor.
 */
const BLOCKED_STATUSES = new Set([402, 403, 429])

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export type CheckUrlResult = {
  status: 'ok' | 'broken' | 'blocked'
  statusCode: number | null
  resolvedUrl: string | null
}

// ---------------------------------------------------------------------------
// Checker
// ---------------------------------------------------------------------------

function classify(statusCode: number): CheckUrlResult['status'] {
  if (statusCode >= 200 && statusCode < 400) return 'ok'
  if (BLOCKED_STATUSES.has(statusCode)) return 'blocked'
  return 'broken'
}

/**
 * Check whether a URL resolves. HEAD first; on RETRY_ON statuses, retries
 * with GET. Private/internal URLs are skipped and reported as broken.
 *
 * @param fetchFn  Injected fetch for tests; defaults to global `fetch`.
 */
export async function checkUrl(
  url: string,
  fetchFn: typeof fetch = fetch,
): Promise<CheckUrlResult> {
  if (isPrivateUrl(url)) {
    return { status: 'broken', statusCode: null, resolvedUrl: null }
  }

  return auditedCall(
    { provider: 'http', operation: 'check_link_weekly', kind: 'external' },
    async (ctx): Promise<CheckUrlResult> => {
      const request = async (
        method: 'HEAD' | 'GET',
      ): Promise<{ status: number; url: string }> => {
        const response = await fetchFn(url, {
          method,
          headers: { 'User-Agent': BROWSER_UA },
          redirect: 'follow',
          signal: AbortSignal.timeout(TIMEOUT_MS),
        })
        return { status: response.status, url: response.url || url }
      }

      let result: { status: number; url: string }

      try {
        result = await request('HEAD')
        if (RETRY_ON.has(result.status)) {
          result = await request('GET')
        }
      } catch {
        try {
          result = await request('GET')
        } catch (error) {
          ctx.summary.error =
            error instanceof Error ? error.message : 'failed'
          return { status: 'broken', statusCode: null, resolvedUrl: null }
        }
      }

      ctx.summary.status = result.status
      ctx.summary.resolvedUrl = result.url
      return {
        status: classify(result.status),
        statusCode: result.status,
        resolvedUrl: result.url,
      }
    },
    {
      classify: (r) =>
        r.statusCode === null
          ? 'network_error'
          : r.status === 'ok'
            ? 'succeeded'
            : 'failed',
    },
  )
}
