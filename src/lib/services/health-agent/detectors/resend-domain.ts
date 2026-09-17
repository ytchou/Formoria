/**
 * Resend domain detector — verifies that the configured Resend sending
 * domain is in a verified state.
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

interface ResendDomain {
  id: string
  name: string
  status: string
  region: string
}

// ---------------------------------------------------------------------------
// Detector
// ---------------------------------------------------------------------------

export const resendDomainDetector: Detector = {
  name: 'resend-domain',
  source: 'credential',
  schedule: 'nightly',
  severity: 'high',

  async run(ctx: DetectorContext): Promise<HealthFinding[]> {
    const env = getEnv(ctx)
    const apiKey = env.RESEND_API_KEY
    if (!apiKey) return []

    const fetchFn = getFetch(ctx)

    const response = await auditedCall(
      {
        provider: 'health-agent',
        operation: 'probe_resend_domain',
        kind: 'external',
        meta: { endpoint: 'https://api.resend.com/domains', method: 'GET' },
      },
      async () => {
        return fetchFn('https://api.resend.com/domains', {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: ctx.signal,
        })
      },
    )

    if (!response.ok) {
      return [
        {
          source: 'credential',
          fingerprint: stableFingerprint('credential', 'resend-domain', 'api-error'),
          title: `Resend domains API returned HTTP ${response.status}`,
          severity: 'high',
          evidence: { status: response.status },
          mergePolicy: 'human',
        },
      ]
    }

    const body = (await response.json()) as { data?: ResendDomain[] }
    const domains = body.data ?? []

    const findings: HealthFinding[] = []
    for (const domain of domains) {
      if (domain.status !== 'verified') {
        findings.push({
          source: 'credential',
          fingerprint: stableFingerprint('credential', 'resend-domain', domain.name),
          title: `Resend domain "${domain.name}" is not verified (status: ${domain.status})`,
          severity: 'high',
          evidence: {
            domainId: domain.id,
            domainName: domain.name,
            status: domain.status,
          },
          mergePolicy: 'human',
        })
      }
    }

    return findings
  },
}
