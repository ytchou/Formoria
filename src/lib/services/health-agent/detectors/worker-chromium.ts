/**
 * Worker Chromium detector — verifies that the curation worker service
 * is reachable and authenticated.
 */

import { auditedCall } from '@/lib/audit'
import { stableFingerprint, type HealthFinding } from '../contracts'
import type { Detector, DetectorContext } from '../types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Env = Record<string, string | undefined>
type FetchFn = typeof fetch

function getEnv(ctx: DetectorContext): Env {
  return (ctx.deps.env as Env | undefined) ?? {}
}

function getFetch(ctx: DetectorContext): FetchFn {
  return (ctx.deps.fetch as FetchFn | undefined) ?? fetch
}

const PROBE_PATH = '/health'

/**
 * An explicit `CURATION_WORKER_URL` wins; otherwise the bare domain Railway
 * injects for the sibling service, which is all the health-agent service has.
 */
function resolveWorkerUrl(env: Env): string | undefined {
  const explicit = env.CURATION_WORKER_URL?.trim()
  if (explicit) return explicit.replace(/\/+$/, '')
  const railwayDomain = env.RAILWAY_SERVICE_CURATION_WORKER_URL?.trim()
  return railwayDomain ? `https://${railwayDomain.replace(/\/+$/, '')}` : undefined
}

// ---------------------------------------------------------------------------
// Detector
// ---------------------------------------------------------------------------

export const workerChromiumDetector: Detector = {
  name: 'worker-chromium',
  source: 'credential',
  schedule: 'nightly',
  severity: 'high',

  async run(ctx: DetectorContext): Promise<HealthFinding[]> {
    const env = getEnv(ctx)
    const workerUrl = resolveWorkerUrl(env)
    if (!workerUrl) return []

    const fetchFn = getFetch(ctx)
    const endpoint = `${workerUrl}${PROBE_PATH}`

    // `/health` is unauthenticated on the worker, so no control token is sent.
    const response = await auditedCall(
      {
        provider: 'health-agent',
        operation: 'probe_worker_chromium',
        kind: 'external',
        meta: { endpoint, method: 'GET' },
      },
      async () => {
        return fetchFn(endpoint, { signal: ctx.signal })
      },
    )

    if (!response.ok) {
      return [
        {
          source: 'credential',
          fingerprint: stableFingerprint('credential', 'worker-chromium', 'render'),
          title: `Worker Chromium health check failed: HTTP ${response.status}`,
          severity: 'high',
          evidence: { status: response.status, endpoint },
          mergePolicy: 'human',
        },
      ]
    }

    const body = await response.text()
    if (!body || body.trim().length === 0) {
      return [
        {
          source: 'credential',
          fingerprint: stableFingerprint('credential', 'worker-chromium', 'empty-render'),
          title: 'Worker Chromium health check returned empty response',
          severity: 'high',
          evidence: { endpoint, bodyLength: 0 },
          mergePolicy: 'human',
        },
      ]
    }

    return []
  },
}
