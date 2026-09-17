/**
 * Detector registry types for the health agent.
 *
 * Mirrors `src/lib/services/enrich-blocks/registry.ts`: a typed entry shape
 * with injected dependencies and a result contract.
 */

import type { DetectorName, HealthSource } from '@/lib/constants/health-detectors'
import type { HealthFinding, HealthSeverity } from './contracts'

// ---------------------------------------------------------------------------
// Detector context — injected into every detector run
// ---------------------------------------------------------------------------

export type DetectorContext = {
  /** ISO date string (YYYY-MM-DD, Asia/Taipei). */
  date: string
  /** Absolute wall-clock deadline (Date.now() epoch ms). */
  deadline: number
  /** AbortSignal that fires at `deadline`. */
  signal: AbortSignal
  /** Dry run: detectors should skip writes. */
  dryRun: boolean
  /** Injected dependencies — database client, fetch, etc. */
  deps: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Detector result
// ---------------------------------------------------------------------------

export type DetectorResult = {
  name: DetectorName
  source: HealthSource
  status: 'ok' | 'failed'
  findings: HealthFinding[]
  /** Populated when status === 'failed'. */
  error?: string
  durationMs: number
}

// ---------------------------------------------------------------------------
// Detector entry — the registry shape
// ---------------------------------------------------------------------------

export type DetectorThresholds = Record<string, number>

export type Detector = {
  name: DetectorName
  source: HealthSource
  schedule: 'nightly' | 'weekly'
  severity: HealthSeverity
  thresholds?: DetectorThresholds
  precondition?: (ctx: DetectorContext) => boolean | Promise<boolean>
  run: (ctx: DetectorContext) => Promise<HealthFinding[]>
}

// ---------------------------------------------------------------------------
// Runner output
// ---------------------------------------------------------------------------

export type RunDetectorsResult = {
  results: DetectorResult[]
  completedSources: HealthSource[]
}
