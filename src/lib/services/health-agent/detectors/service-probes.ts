/**
 * Service probes detector — wraps executive-health and converts
 * non-healthy, non-unconfigured results into health-agent findings.
 *
 * Reuses the existing executive-health infrastructure (`loadExecutiveHealth`)
 * so every service already checked there is covered without duplication.
 */

import type {
  ExecutiveHealthSnapshot,
  ExecutiveServiceHealth,
} from '@/lib/services/executive-health'
import { stableFingerprint, type HealthFinding } from '../contracts'
import type { Detector, DetectorContext } from '../types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type LoadExecutiveHealth = () => Promise<ExecutiveHealthSnapshot>

function getLoader(ctx: DetectorContext): LoadExecutiveHealth | null {
  const loader = ctx.deps.loadExecutiveHealth as LoadExecutiveHealth | undefined
  return loader ?? null
}

function severityFor(service: ExecutiveServiceHealth): HealthFinding['severity'] {
  if (service.status === 'down') return 'high'
  // degraded
  return 'medium'
}

function serviceToFinding(service: ExecutiveServiceHealth): HealthFinding {
  return {
    source: 'credential',
    fingerprint: stableFingerprint('credential', 'service-probe', service.id),
    title: `Service probe "${service.service}" is ${service.status}: ${service.message}`,
    severity: severityFor(service),
    evidence: {
      serviceId: service.id,
      service: service.service,
      tier: service.tier,
      status: service.status,
      message: service.message,
      checkedAt: service.checkedAt,
    },
    mergePolicy: 'human',
  }
}

// ---------------------------------------------------------------------------
// Detector
// ---------------------------------------------------------------------------

export const serviceProbesDetector: Detector = {
  name: 'service-probes',
  source: 'credential',
  schedule: 'nightly',
  severity: 'high',

  async run(ctx: DetectorContext): Promise<HealthFinding[]> {
    const loader = getLoader(ctx)
    if (!loader) return []

    const snapshot = await loader()
    const findings: HealthFinding[] = []

    for (const service of snapshot.services) {
      // Skip healthy and unconfigured services
      if (service.status === 'healthy' || service.status === 'unconfigured') {
        continue
      }
      findings.push(serviceToFinding(service))
    }

    return findings
  },
}
