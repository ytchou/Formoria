/**
 * Langfuse credential detector — verifies that traces are arriving and
 * that configured snapshot prompt names resolve.
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

function getSnapshotPromptNames(ctx: DetectorContext): string[] {
  return (ctx.deps.snapshotPromptNames as string[] | undefined) ?? []
}

function basicAuth(publicKey: string, secretKey: string): string {
  const encoded = Buffer.from(`${publicKey}:${secretKey}`).toString('base64')
  return `Basic ${encoded}`
}

// ---------------------------------------------------------------------------
// Detector
// ---------------------------------------------------------------------------

export const langfuseDetector: Detector = {
  name: 'langfuse',
  source: 'credential',
  schedule: 'nightly',
  severity: 'high',

  async run(ctx: DetectorContext): Promise<HealthFinding[]> {
    const env = getEnv(ctx)
    const publicKey = env.LANGFUSE_PUBLIC_KEY
    const secretKey = env.LANGFUSE_SECRET_KEY
    const host = env.LANGFUSE_HOST
    if (!publicKey || !secretKey || !host) return []

    const fetchFn = getFetch(ctx)
    const auth = basicAuth(publicKey, secretKey)
    const findings: HealthFinding[] = []

    // Check 1: Any trace arrived in the last 24 hours
    const tracesResponse = await auditedCall(
      {
        provider: 'health-agent',
        operation: 'probe_langfuse_traces',
        kind: 'external',
        meta: { endpoint: `${host}/api/public/traces`, method: 'GET' },
      },
      async () => {
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
        return fetchFn(
          `${host}/api/public/traces?limit=1&orderBy=timestamp&order=DESC&fromTimestamp=${encodeURIComponent(since)}`,
          {
            headers: { Authorization: auth },
            signal: ctx.signal,
          },
        )
      },
    )

    if (tracesResponse.ok) {
      const body = (await tracesResponse.json()) as { data?: unknown[] }
      if (!body.data || body.data.length === 0) {
        findings.push({
          source: 'credential',
          fingerprint: stableFingerprint('credential', 'langfuse', 'no-recent-traces'),
          title: 'Langfuse: no trace arrived in the last 24 hours',
          severity: 'high',
          evidence: { hoursChecked: 24 },
          mergePolicy: 'human',
        })
      }
    } else {
      findings.push({
        source: 'credential',
        fingerprint: stableFingerprint('credential', 'langfuse', 'traces-api-error'),
        title: `Langfuse traces API returned HTTP ${tracesResponse.status}`,
        severity: 'high',
        evidence: { status: tracesResponse.status },
        mergePolicy: 'human',
      })
    }

    // Check 2: Snapshot prompt names resolve
    const promptNames = getSnapshotPromptNames(ctx)
    for (const name of promptNames) {
      const promptResponse = await auditedCall(
        {
          provider: 'health-agent',
          operation: 'probe_langfuse_prompt',
          kind: 'external',
          meta: { endpoint: `${host}/api/public/v2/prompts/${name}`, method: 'GET' },
        },
        async () => {
          return fetchFn(`${host}/api/public/v2/prompts/${encodeURIComponent(name)}`, {
            headers: { Authorization: auth },
            signal: ctx.signal,
          })
        },
      )

      if (!promptResponse.ok) {
        findings.push({
          source: 'credential',
          fingerprint: stableFingerprint('credential', 'langfuse', `prompt-${name}`),
          title: `Langfuse prompt "${name}" does not resolve: HTTP ${promptResponse.status}`,
          severity: 'high',
          evidence: { promptName: name, status: promptResponse.status },
          mergePolicy: 'human',
        })
      }
    }

    return findings
  },
}
