/**
 * Linear credential detector — verifies the Linear API key can execute
 * a viewer query.
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

// ---------------------------------------------------------------------------
// Detector
// ---------------------------------------------------------------------------

export const linearDetector: Detector = {
  name: 'linear',
  source: 'credential',
  schedule: 'nightly',
  severity: 'high',

  async run(ctx: DetectorContext): Promise<HealthFinding[]> {
    const env = getEnv(ctx)
    const apiKey = env.LINEAR_API_KEY
    if (!apiKey) return []

    const fetchFn = getFetch(ctx)

    const response = await auditedCall(
      {
        provider: 'health-agent',
        operation: 'probe_linear',
        kind: 'external',
        meta: { endpoint: 'https://api.linear.app/graphql', method: 'POST' },
      },
      async () => {
        return fetchFn('https://api.linear.app/graphql', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: apiKey,
          },
          body: JSON.stringify({ query: '{ viewer { id } }' }),
          signal: ctx.signal,
        })
      },
    )

    if (!response.ok) {
      return [
        {
          source: 'credential',
          fingerprint: stableFingerprint('credential', 'linear', 'viewer-query'),
          title: `Linear API key rejected: HTTP ${response.status}`,
          severity: 'high',
          evidence: { status: response.status },
          mergePolicy: 'human',
        },
      ]
    }

    const body = (await response.json()) as { errors?: { message: string }[]; data?: unknown }
    if (body.errors && body.errors.length > 0) {
      return [
        {
          source: 'credential',
          fingerprint: stableFingerprint('credential', 'linear', 'viewer-query'),
          title: `Linear viewer query failed: ${body.errors[0].message}`,
          severity: 'high',
          evidence: { errors: body.errors.map((e) => e.message) },
          mergePolicy: 'human',
        },
      ]
    }

    return []
  },
}
