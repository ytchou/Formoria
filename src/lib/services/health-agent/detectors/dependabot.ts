/**
 * Dependabot detector — reports high and critical open dependency alerts.
 *
 * Re-uses the pure evaluate function from `scripts/health-agent/directory.ts`.
 */

import {
  evaluateDependabotAlerts,
  type DependabotAlertEvidence,
  type DependabotSeverity,
} from '../../../../../scripts/health-agent/directory'
import type { HealthFinding } from '../contracts'
import type { Detector, DetectorContext } from '../types'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Only alerts newer than this are considered. */
const DEPENDABOT_LOOKBACK_DAYS = 14

// ---------------------------------------------------------------------------
// Port
// ---------------------------------------------------------------------------

export type DependabotAlertRecord = {
  readonly alertId: string
  readonly packageName: string
  readonly severity: DependabotSeverity
}

export interface DependabotAlertsPort {
  listOpenAlerts(input: {
    signal: AbortSignal
  }): Promise<readonly DependabotAlertRecord[]>
}

export function dependabotDetector(alertsPort: DependabotAlertsPort): Detector {
  return {
    name: 'dependabot',
    source: 'directory',
    schedule: 'nightly',
    severity: 'high',
    thresholds: {
      lookbackDays: DEPENDABOT_LOOKBACK_DAYS,
    },

    async run(ctx: DetectorContext): Promise<HealthFinding[]> {
      const response = await alertsPort.listOpenAlerts({ signal: ctx.signal })
      const alerts: DependabotAlertEvidence[] = response.map(
        (alert): DependabotAlertEvidence => ({
          ...alert,
          state: 'open',
          versionImpact: 'unknown',
        }),
      )

      const result = evaluateDependabotAlerts(alerts)
      return result.findings
    },
  }
}
