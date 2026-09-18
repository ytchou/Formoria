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

export type MergePolicy = 'automatic' | 'human'

export type HealthFindingDisposition = 'report_only'

export type JsonPrimitive = string | number | boolean | null
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

export type HealthSummaryStatus = 'failed' | 'skipped' | 'success'

export interface HealthDeliveryWarning {
  category: 'optional_delivery'
  code: string
  operation: string
  reason: string
}

export interface HealthInfrastructureFailure {
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

export type AuditLogger = (record: AuditRecord) => void

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

