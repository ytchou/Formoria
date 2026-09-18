/**
 * Health-agent contracts — re-exports and additions for the service-layer agent.
 *
 * Copied from `scripts/health-agent/contracts.ts` and adapted:
 * - `HealthSource` comes from the registry (`src/lib/constants/health-detectors.ts`)
 *   so every new source is declared once.
 * - All types that the runner, lifecycle, and report modules need live here.
 */

export { type HealthSource, HEALTH_SOURCES } from '@/lib/constants/health-detectors'

const HEALTH_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const
export type HealthSeverity = (typeof HEALTH_SEVERITIES)[number]

const MERGE_POLICIES = ['automatic', 'human'] as const
type MergePolicy = (typeof MERGE_POLICIES)[number]

export type HealthFindingDisposition = 'report_only'

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
  humanReason?: string
  changedFiles?: readonly string[]
  sentryIssueId?: string
}

type HealthSummaryStatus = 'failed' | 'skipped' | 'success'

interface HealthDeliveryWarning {
  category: 'optional_delivery'
  code: string
  operation: string
  reason: string
}

interface HealthInfrastructureFailure {
  category: 'infrastructure'
  code: string
  operation: string
  reason: string
}

export interface AuditRecord {
  adapter: string
  operation: string
  status: 'success' | 'failure' | 'suppressed'
  latencyMs: number
  request: Record<string, JsonValue>
  response: Record<string, JsonValue>
  schemaValid?: boolean
}

type AuditLogger = (record: AuditRecord) => void

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

function requiresHumanPolicy(
  finding: Pick<HealthFinding, 'source' | 'mergePolicy' | 'humanReason'>,
): boolean {
  return finding.mergePolicy === 'human' || Boolean(finding.humanReason)
}
