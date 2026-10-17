import { expect, type APIResponse } from '@playwright/test'

import { POLL } from '../budgets'

/**
 * Sends a request again while the Cloudflare /api/* rule answers 429 (10
 * requests per 10 s per IP, then a 10 s block). The app never returns these
 * 429s: the block comes from the edge. Earlier /api traffic from the same IP,
 * in the calling spec or in another one, can fill the edge window, so any /api
 * call can land in a block.
 *
 * Only a 429 is retried. An error thrown by `send()` (ECONNRESET, a request
 * timeout) escapes at once, so it is never reported as a rate-limit wait.
 *
 * One call can wait up to POLL.EDGE_RATE_LIMIT.timeout, so the test budget must
 * cover every wrapped call plus headroom, or the test timeout fires first and
 * hides the 429.
 *
 * Remove when the CF-Access service token skips that rule.
 */
export async function outsideEdgeRateLimit(
  send: () => Promise<APIResponse>,
): Promise<APIResponse> {
  let response!: APIResponse
  // A holder, not a `let`: TS does not see assignments made inside the callback.
  const transport: { failed: boolean; error?: unknown } = { failed: false }
  await expect(async () => {
    try {
      response = await send()
    } catch (error) {
      // Ends the retry loop; rethrown below, outside toPass.
      transport.failed = true
      transport.error = error
      return
    }
    expect(
      response.status(),
      'Cloudflare edge rate limit: the last status was 429',
    ).not.toBe(429)
  }).toPass(POLL.EDGE_RATE_LIMIT)
  if (transport.failed) throw transport.error
  return response
}
