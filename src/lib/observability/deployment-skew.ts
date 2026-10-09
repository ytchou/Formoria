/**
 * A tab left open across a deploy posts a Server Action ID the new build no
 * longer has. Next.js surfaces this as "Failed to find Server Action" on the
 * server and as an `UnrecognizedActionError` on the client (Next 16 answers an
 * unknown action with `x-nextjs-action-not-found`). Neither is recoverable by
 * `reset()`, which re-runs the same stale bundle, so these need a hard reload
 * instead (DEV-1340 / FORMORIA-4R, FORMORIA-55).
 *
 * The router's generic "unexpected response" (any non-RSC reply) is skew only
 * when the reply was a 404 or 400. The same message covers the staging
 * lockdown's 403, a Cloudflare challenge, a 429 and a 5xx HTML page — real
 * failures that must not be filed as low-severity skew (DEV-1975, DEV-1987).
 * With no known status it is not skew. Kept dependency-free: the root client
 * bundle imports it via ViewerProvider.
 */
const UNEXPECTED_RESPONSE = 'An unexpected response was received from the server'
const SKEW_STATUSES = new Set([400, 404])

export function isDeploymentSkewError(error: unknown, status?: number): boolean {
  if (!(error instanceof Error)) return false
  if (
    error.message.includes('Failed to find Server Action') ||
    error.name === 'UnrecognizedActionError'
  ) {
    return true
  }
  return (
    error.message.includes(UNEXPECTED_RESPONSE) &&
    status !== undefined &&
    SKEW_STATUSES.has(status)
  )
}

type ResourceTimeline = {
  getEntriesByName?: (name: string, type?: string) => PerformanceEntryList
}

/**
 * HTTP status of the latest Server Action POST from this page, if the browser
 * recorded one. Next posts actions to the current URL and throws an Error with
 * no status attached, so Resource Timing is the only place the status survives.
 *
 * Best effort, and `undefined` means unknown: `responseStatus` is not exposed
 * by Safari, the entry can lag the rejection, and the resource buffer (250
 * entries by default) stops recording when full. Callers must treat unknown as
 * "not skew". Upgrade path: move viewer context to a GET route handler whose
 * `Response.status` is read directly.
 */
export function serverActionResponseStatus(
  href: string | undefined = typeof window === 'undefined' ? undefined : window.location.href,
  timeline: ResourceTimeline = typeof performance === 'undefined' ? {} : performance,
): number | undefined {
  if (!href || typeof timeline.getEntriesByName !== 'function') return undefined
  const entries = timeline.getEntriesByName(href.replace(/#.*$/, ''), 'resource')
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index] as Partial<PerformanceResourceTiming>
    if (entry.initiatorType === 'fetch' && entry.responseStatus) {
      return entry.responseStatus
    }
  }
  return undefined
}
