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
    const workerUrl = env.CURATION_WORKER_URL?.replace(/\/+$/, '')
    const workerToken = env.CURATION_WORKER_CONTROL_TOKEN
    if (!workerUrl || !workerToken) return []

    const fetchFn = getFetch(ctx)
    const endpoint = `${workerUrl}${PROBE_PATH}`

    const response = await auditedCall(
      {
        provider: 'health-agent',
        operation: 'probe_worker_chromium',
        kind: 'external',
        meta: { endpoint, method: 'GET' },
      },
      async () => {
        return fetchFn(endpoint, {
          headers: { Authorization: `Bearer ${workerToken}` },
          signal: ctx.signal,
        })
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
