/**
 * Dependabot detector — reports high and critical open dependency alerts.
 *
 * Re-uses the pure evaluate function from `scripts/health-agent/directory.ts`.
 */

import {
  evaluateDependabotAlerts,
  type DependabotAlertEvidence,
  type DependabotSeverity,
  type VersionImpact,
} from '../../../../../scripts/health-agent/directory'
import { auditedCall } from '@/lib/audit'
import type { HealthFinding } from '../contracts'
import type { Detector, DetectorContext } from '../types'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Only alerts newer than this are considered. */
const DEPENDABOT_LOOKBACK_DAYS = 14

// ---------------------------------------------------------------------------
// DI seam
// ---------------------------------------------------------------------------

export type DependabotDeps = {
  /** GitHub token with security_events scope. */
  githubToken: string
  /** Owner/repo, e.g. 'formoria/formoria'. */
  repo: string
  /** Injected fetch for testing. */
  fetchImpl?: typeof fetch
}

type GitHubDependabotAlert = {
  number: number
  state: string
  security_advisory?: {
    severity?: string
  }
  security_vulnerability?: {
    package?: { name?: string }
    first_patched_version?: { identifier?: string }
  }
  dependency?: {
    package?: { name?: string }
  }
}

function mapSeverity(raw: string | undefined): DependabotSeverity {
  const lower = (raw ?? '').toLowerCase()
  if (lower === 'critical') return 'critical'
  if (lower === 'high') return 'high'
  if (lower === 'medium') return 'medium'
  return 'low'
}

function mapVersionImpact(
  _alert: GitHubDependabotAlert,
): VersionImpact {
  // Ceiling: parse first_patched_version against current to determine
  // patch/minor/major. For now, return 'unknown' and let the evaluate
  // function assign human merge policy.
  return 'unknown'
}

export function dependabotDetector(deps: DependabotDeps): Detector {
  return {
    name: 'dependabot',
    source: 'directory',
    schedule: 'nightly',
    severity: 'high',
    thresholds: {
      lookbackDays: DEPENDABOT_LOOKBACK_DAYS,
    },

    async run(_ctx: DetectorContext): Promise<HealthFinding[]> {
      const fetchFn = deps.fetchImpl ?? fetch
      const url = `https://api.github.com/repos/${deps.repo}/dependabot/alerts?state=open&per_page=100`

      const response = await auditedCall(
        {
          provider: 'github',
          operation: 'list_dependabot_alerts',
          kind: 'external',
        },
        async () => {
          const res = await fetchFn(url, {
            headers: {
              Authorization: `Bearer ${deps.githubToken}`,
              Accept: 'application/vnd.github+json',
              'X-GitHub-Api-Version': '2022-11-28',
            },
          })
          if (!res.ok) {
            throw new Error(`GitHub API returned ${res.status}`)
          }
          return res.json() as Promise<GitHubDependabotAlert[]>
        },
      )

      const alerts: DependabotAlertEvidence[] = response.map(
        (alert): DependabotAlertEvidence => ({
          alertId: String(alert.number),
          packageName:
            alert.dependency?.package?.name ??
            alert.security_vulnerability?.package?.name ??
            'unknown',
          severity: mapSeverity(alert.security_advisory?.severity),
          state:
            alert.state === 'open'
              ? 'open'
              : alert.state === 'dismissed'
                ? 'dismissed'
                : 'fixed',
          versionImpact: mapVersionImpact(alert),
        }),
      )

      const result = evaluateDependabotAlerts(alerts)
      return result.findings
    },
  }
}
