import { describe, expect, it } from 'vitest'

import {
  evaluateDependabotAlerts,
  type DependabotAlertEvidence,
} from '../../../../../../scripts/health-agent/directory'

describe('dependabot detector', () => {
  it('reports only high and critical open alerts', () => {
    const alerts: DependabotAlertEvidence[] = [
      {
        alertId: 'alert-1',
        packageName: 'lodash',
        severity: 'critical',
        state: 'open',
        versionImpact: 'patch',
      },
      {
        alertId: 'alert-2',
        packageName: 'express',
        severity: 'high',
        state: 'open',
        versionImpact: 'minor',
      },
      {
        alertId: 'alert-3',
        packageName: 'react',
        severity: 'medium',
        state: 'open',
        versionImpact: 'patch',
      },
      {
        alertId: 'alert-4',
        packageName: 'axios',
        severity: 'low',
        state: 'open',
        versionImpact: 'patch',
      },
      {
        alertId: 'alert-5',
        packageName: 'next',
        severity: 'critical',
        state: 'dismissed',
        versionImpact: 'major',
      },
      {
        alertId: 'alert-6',
        packageName: 'typescript',
        severity: 'high',
        state: 'fixed',
        versionImpact: 'minor',
      },
    ]

    const result = evaluateDependabotAlerts(alerts)

    // Only alert-1 (critical+open) and alert-2 (high+open) should be reported
    expect(result.findings).toHaveLength(2)
    expect(result.snapshot.actionableAlertIds).toEqual(['alert-1', 'alert-2'])

    // alert-3 (medium) excluded even though open
    expect(result.findings.find((f) => f.evidence.alertId === 'alert-3')).toBeUndefined()
    // alert-5 (dismissed) excluded even though critical
    expect(result.findings.find((f) => f.evidence.alertId === 'alert-5')).toBeUndefined()

    // patch/minor get automatic merge policy
    expect(result.snapshot.automaticAlertIds).toEqual(['alert-1', 'alert-2'])
    expect(result.snapshot.humanAlertIds).toEqual([])
  })

  it('assigns human merge policy to major version impact alerts', () => {
    const alerts: DependabotAlertEvidence[] = [
      {
        alertId: 'alert-major',
        packageName: 'big-lib',
        severity: 'high',
        state: 'open',
        versionImpact: 'major',
      },
    ]

    const result = evaluateDependabotAlerts(alerts)

    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]!.mergePolicy).toBe('human')
    expect(result.findings[0]!.humanReason).toBe(
      'Major dependency upgrades require approval',
    )
    expect(result.snapshot.humanAlertIds).toEqual(['alert-major'])
  })
})
