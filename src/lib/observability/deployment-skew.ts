/**
 * A tab left open across a deploy posts a Server Action ID the new build no
 * longer has. Next.js surfaces this two ways — server-side as "Failed to find
 * Server Action", client-side as the router's generic "unexpected response".
 * Neither is recoverable by `reset()`, which re-runs the same stale bundle, so
 * these need a hard reload instead (DEV-1340 / FORMORIA-4R, FORMORIA-55).
 *
 * The client message also fires when a layer in front of the action handler
 * (staging lockdown, origin guard, Cloudflare challenge) answers the POST with
 * a non-RSC response (DEV-1975). Kept dependency-free: the root client bundle
 * imports it via ViewerProvider.
 */
export function isDeploymentSkewError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return (
    error.message.includes('Failed to find Server Action') ||
    error.message.includes('An unexpected response was received from the server')
  )
}
