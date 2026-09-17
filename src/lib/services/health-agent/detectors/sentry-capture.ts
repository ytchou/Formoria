/**
 * Sentry capture round-trip detector — triggers a canary error at the
 * Railway origin and polls the Sentry issues API until the matching
 * event appears or the soft deadline expires.
 *
 * The canary is fired at `FORMORIA_RAILWAY_URL/api/cron/health-canary`
 * with the `x-origin-verify` header, producing a tagged Sentry event.
 * The detector then polls for the tag to confirm end-to-end capture.
 */

import { randomUUID } from 'node:crypto'
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

const DEFAULT_POLL_INTERVAL_MS = 5_000
const DEFAULT_MAX_POLL_ATTEMPTS = 12 // ~60 seconds

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return }
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason) }, { once: true })
  })
}

// ---------------------------------------------------------------------------
// Detector
// ---------------------------------------------------------------------------

export const sentryCaptureDetector: Detector = {
  name: 'sentry-capture',
  source: 'credential',
  schedule: 'nightly',
  severity: 'high',

  async run(ctx: DetectorContext): Promise<HealthFinding[]> {
    const env = getEnv(ctx)
    const token = env.SENTRY_AUTH_TOKEN
    const baseUrl = env.SENTRY_BASE_URL?.replace(/\/+$/, '')
    const organization = env.SENTRY_ORGANIZATION
    const project = env.SENTRY_PROJECT
    const railwayUrl = env.FORMORIA_RAILWAY_URL?.replace(/\/+$/, '')
    const originSecret = env.CF_ORIGIN_SECRET
    if (!token || !baseUrl || !organization || !project || !railwayUrl) return []

    const fetchFn = getFetch(ctx)
    const canaryToken = randomUUID()
    const pollInterval = (ctx.deps.pollIntervalMs as number | undefined) ?? DEFAULT_POLL_INTERVAL_MS
    const maxAttempts = (ctx.deps.maxPollAttempts as number | undefined) ?? DEFAULT_MAX_POLL_ATTEMPTS

    // Step 1: Trigger the canary at the Railway origin
    const canaryUrl = `${railwayUrl}/api/cron/health-canary?token=${encodeURIComponent(canaryToken)}`
    const triggerResponse = await auditedCall(
      {
        provider: 'health-agent',
        operation: 'probe_sentry_capture_trigger',
        kind: 'external',
        meta: { endpoint: canaryUrl, method: 'GET' },
      },
      async () => {
        const headers: Record<string, string> = {}
        if (originSecret) {
          headers['x-origin-verify'] = originSecret
        }
        return fetchFn(canaryUrl, { headers, signal: ctx.signal })
      },
    )

    if (!triggerResponse.ok) {
      return [
        {
          source: 'credential',
          fingerprint: stableFingerprint('credential', 'sentry-capture', 'canary-trigger'),
          title: `Sentry canary trigger failed: HTTP ${triggerResponse.status}`,
          severity: 'high',
          evidence: { status: triggerResponse.status, canaryUrl },
          mergePolicy: 'human',
        },
      ]
    }

    // Step 2: Poll Sentry issues API for the canary tag
    const issuesUrl = `${baseUrl}/api/0/projects/${encodeURIComponent(organization)}/${encodeURIComponent(project)}/issues/?query=HealthCanary+${canaryToken}&limit=1`
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0 && pollInterval > 0) {
        try {
          await sleep(pollInterval, ctx.signal)
        } catch {
          break // Deadline exceeded
        }
      }

      const pollResponse = await auditedCall(
        {
          provider: 'health-agent',
          operation: 'probe_sentry_capture_poll',
          kind: 'external',
          meta: { endpoint: issuesUrl, method: 'GET', attempt },
        },
        async () => {
          return fetchFn(issuesUrl, {
            headers: { Authorization: `Bearer ${token}` },
            signal: ctx.signal,
          })
        },
      )

      if (pollResponse.ok) {
        const issues = (await pollResponse.json()) as unknown[]
        if (issues.length > 0) {
          return [] // Found the canary event
        }
      }
    }

    return [
      {
        source: 'credential',
        fingerprint: stableFingerprint('credential', 'sentry-capture', 'round-trip'),
        title: 'Sentry capture round-trip: canary event not found before deadline',
        severity: 'high',
        evidence: { canaryToken, maxAttempts, pollInterval },
        mergePolicy: 'human',
      },
    ]
  },
}
