/**
 * Trail supply detector — fetches the trail supply report from the Railway
 * origin and evaluates it for decay.
 *
 * Re-uses the pure evaluate function from `scripts/health-agent/trail-supply.ts`.
 */

import {
  evaluateTrailSupply,
  parseTrailSupplyReport,
} from '../../../../../scripts/health-agent/trail-supply'
import { auditedCall } from '@/lib/audit'
import type { HealthFinding } from '../contracts'
import { stableFingerprint } from '../contracts'
import type { Detector, DetectorContext } from '../types'

// ---------------------------------------------------------------------------
// DI seam
// ---------------------------------------------------------------------------

export type TrailSupplyDetectorDeps = {
  /** Railway origin URL (FORMORIA_RAILWAY_URL). */
  railwayUrl: string
  /** CF_ORIGIN_SECRET for the origin route. */
  originSecret: string
  /** Injected fetch for testing. */
  fetchImpl?: typeof fetch
}

export function trailSupplyDetector(deps: TrailSupplyDetectorDeps): Detector {
  return {
    name: 'trail-supply',
    source: 'directory',
    schedule: 'nightly',
    severity: 'medium',

    async run(_ctx: DetectorContext): Promise<HealthFinding[]> {
      const fetchFn = deps.fetchImpl ?? fetch
      const url = `${deps.railwayUrl.replace(/\/$/, '')}/api/cron/trail-supply`

      const response = await auditedCall(
        {
          provider: 'health-agent',
          operation: 'probe_trail_supply',
          kind: 'external',
        },
        async () =>
          fetchFn(url, {
            method: 'GET',
            headers: {
              'x-origin-secret': deps.originSecret,
              Accept: 'application/json',
            },
          }),
      )

      if (!response.ok) {
        return [
          {
            source: 'directory',
            fingerprint: stableFingerprint(
              'directory',
              'trail-supply-fetch',
              'unavailable',
            ),
            title: `Trail supply endpoint unavailable (HTTP ${response.status})`,
            severity: 'high',
            evidence: { httpStatus: response.status },
            mergePolicy: 'human',
          },
        ]
      }

      const body: unknown = await response.json()
      let report
      try {
        report = parseTrailSupplyReport(body)
      } catch {
        return [
          {
            source: 'directory',
            fingerprint: stableFingerprint(
              'directory',
              'trail-supply-parse',
              'invalid',
            ),
            title: 'Trail supply endpoint returned an invalid response',
            severity: 'high',
            evidence: {},
            mergePolicy: 'human',
          },
        ]
      }

      // readUnavailable means the app's trail reading infrastructure is down
      if (report.readUnavailable) {
        return [
          {
            source: 'directory',
            fingerprint: stableFingerprint(
              'directory',
              'trail-supply-read',
              'unavailable',
            ),
            title: 'Trail supply read unavailable',
            severity: 'medium',
            evidence: {
              readUnavailable: true,
              trailsObserved: report.trailsObserved,
              selectionsObserved: report.selectionsObserved,
            },
            mergePolicy: 'human',
          },
        ]
      }

      return evaluateTrailSupply(report)
    },
  }
}
