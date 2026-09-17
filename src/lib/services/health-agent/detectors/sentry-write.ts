/**
 * Sentry write detector — verifies that the Sentry auth token has
 * write permissions by checking the token's scopes.
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

export const sentryWriteDetector: Detector = {
  name: 'sentry-write',
  source: 'credential',
  schedule: 'nightly',
  severity: 'high',

  async run(ctx: DetectorContext): Promise<HealthFinding[]> {
    const env = getEnv(ctx)
    const token = env.SENTRY_AUTH_TOKEN
    const baseUrl = env.SENTRY_BASE_URL?.replace(/\/+$/, '')
    const organization = env.SENTRY_ORGANIZATION
    const project = env.SENTRY_PROJECT
    if (!token || !baseUrl || !organization || !project) return []

    const fetchFn = getFetch(ctx)

    // Use the project client-keys endpoint which requires project:write scope.
    // A read-only token gets 403; a write-capable token gets 200.
    const endpoint = `${baseUrl}/api/0/projects/${encodeURIComponent(organization)}/${encodeURIComponent(project)}/keys/`
    const response = await auditedCall(
      {
        provider: 'health-agent',
        operation: 'probe_sentry_write',
        kind: 'external',
        meta: { endpoint, method: 'GET' },
      },
      async () => {
        return fetchFn(endpoint, {
          headers: { Authorization: `Bearer ${token}` },
          signal: ctx.signal,
        })
      },
    )

    if (!response.ok) {
      return [
        {
          source: 'credential',
          fingerprint: stableFingerprint('credential', 'sentry-write', 'permission'),
          title: `Sentry auth token cannot write: HTTP ${response.status}`,
          severity: 'high',
          evidence: { status: response.status, endpoint },
          mergePolicy: 'human',
        },
      ]
    }

    return []
  },
}
