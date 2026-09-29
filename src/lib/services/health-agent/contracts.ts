/**
 * Health-agent contracts — re-exports and additions for the service-layer agent.
 *
 * Copied from `scripts/health-agent/contracts.ts` and adapted:
 * - `HealthSource` comes from the registry (`src/lib/constants/health-detectors.ts`)
 *   so every new source is declared once.
 * - All types that the runner, lifecycle, and report modules need live here.
 */

export { type HealthSource } from '@/lib/constants/health-detectors'

export type HealthSeverity = 'low' | 'medium' | 'high' | 'critical'

type MergePolicy = 'automatic' | 'human'

/**
 * Forces the ticket route, even for a finding that opted into auto-fix.
 * `scripts/health-agent/*` evaluators still set it.
 */
export type HealthFindingDisposition = 'report_only'

/** Where a finding goes: the auto-fix routine (code PR) or a Linear ticket. */
export type HealthFindingRoute = 'auto_fix' | 'ticket'

type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

export interface HealthFinding {
  source: string
  fingerprint: string
  title: string
  severity: HealthSeverity
  evidence: Record<string, JsonValue>
  mergePolicy: MergePolicy
  disposition?: HealthFindingDisposition
  /**
   * Opt-in: set only where the ops routine can fix the finding with a code
   * PR. Absent means ticket.
   */
  route?: Extract<HealthFindingRoute, 'auto_fix'>
  humanReason?: string
  changedFiles?: readonly string[]
  sentryIssueId?: string
}

/** Auto-fix is opt-in; ticket is the default, and `report_only` forces it. */
export function routeOf(finding: HealthFinding): HealthFindingRoute {
  return finding.route === 'auto_fix' && finding.disposition !== 'report_only'
    ? 'auto_fix'
    : 'ticket'
}

export function stableFingerprint(
  source: string,
  kind: string,
  identity: string,
): string {
  const normalizedKind = kind
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
  const normalizedIdentity = identity.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!normalizedKind || !normalizedIdentity) {
    throw new Error('Fingerprint inputs must be nonempty')
  }
  return `${source}:${normalizedKind}:${normalizedIdentity}`
}

