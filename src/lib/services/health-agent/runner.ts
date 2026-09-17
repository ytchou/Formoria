/**
 * Detector runner — executes a set of detectors, wraps each in a span,
 * captures errors into results, and computes completed sources.
 *
 * The runner never throws. A detector that fails becomes a
 * `agent:detector-failure:<name>` finding and its source is excluded from
 * `completedSources`.
 *
 * Pattern: each detector is wrapped in `withNodeSpan('health/<name>', …)`
 * mirroring `src/lib/services/enrich-phases/agents/runtime.ts`.
 */

import {
  DETECTOR_SOURCE,
  isDueOn,
  type DetectorName,
  type HealthSource,
} from '@/lib/constants/health-detectors'
import { withNodeSpan } from '@/lib/services/enrich-phases/agents/runtime'
import { stableFingerprint, type HealthFinding } from './contracts'
import type { Detector, DetectorContext, DetectorResult, RunDetectorsResult } from './types'

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function detectorFailureFinding(
  name: DetectorName,
  source: HealthSource,
  error: string,
): HealthFinding {
  return {
    source,
    fingerprint: stableFingerprint('agent', 'detector-failure', name),
    title: `Detector "${name}" failed: ${error}`,
    severity: 'high',
    evidence: { detector: name, error },
    mergePolicy: 'human',
  }
}

/**
 * Run a single detector with its soft deadline.
 *
 * The deadline is passed into the callee via `ctx.deadline` and
 * `ctx.signal` — no `Promise.race` against a timer. If the detector
 * exceeds its deadline the AbortSignal fires and it is the detector's
 * responsibility to check it; the runner treats a thrown AbortError as
 * a deadline failure.
 */
async function runOne(
  detector: Detector,
  ctx: DetectorContext,
): Promise<DetectorResult> {
  const start = Date.now()
  try {
    const findings = await withNodeSpan(`health/${detector.name}`, () =>
      detector.run(ctx),
    )
    return {
      name: detector.name,
      source: detector.source,
      status: 'ok',
      findings,
      durationMs: Date.now() - start,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      name: detector.name,
      source: detector.source,
      status: 'failed',
      findings: [detectorFailureFinding(detector.name, detector.source, message)],
      error: message,
      durationMs: Date.now() - start,
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type RunDetectorsOptions = {
  /** Current date (YYYY-MM-DD, Asia/Taipei). */
  now: string
  /**
   * Max detectors running concurrently.
   *
   * Ceiling: bump to use a proper pool (e.g. p-limit) if detectors start
   * doing heavy I/O that benefits from backpressure.
   */
  concurrency: number
  dryRun: boolean
  deps: Record<string, unknown>
  /**
   * Per-detector soft deadline in ms from now.
   *
   * Ceiling: per-detector deadlines if detectors have different ceilings.
   */
  detectorDeadlineMs?: number
}

/**
 * The default per-detector soft deadline: 120 seconds.
 *
 * Ceiling: per-detector configuration if some detectors need longer.
 */
const DEFAULT_DETECTOR_DEADLINE_MS = 120_000

/**
 * Run every due detector from the registry.
 *
 * Skips weekly detectors on non-weekly days. A source is "completed" only
 * when every due detector in that source succeeded.
 *
 * Never throws.
 */
export async function runDetectors(
  registry: Detector[],
  options: RunDetectorsOptions,
): Promise<RunDetectorsResult> {
  const dueNames = new Set(isDueOn(options.now))
  const dueDetectors = registry.filter((d) => dueNames.has(d.name))
  const results: DetectorResult[] = []

  // Run in concurrency-limited batches.
  for (let i = 0; i < dueDetectors.length; i += options.concurrency) {
    const batch = dueDetectors.slice(i, i + options.concurrency)
    const batchResults = await Promise.all(
      batch.map((detector) => {
        const deadlineMs = options.detectorDeadlineMs ?? DEFAULT_DETECTOR_DEADLINE_MS
        const deadline = Date.now() + deadlineMs
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), deadlineMs)

        const ctx: DetectorContext = {
          date: options.now,
          deadline,
          signal: controller.signal,
          dryRun: options.dryRun,
          deps: options.deps,
        }

        return runOne(detector, ctx).finally(() => clearTimeout(timer))
      }),
    )
    results.push(...batchResults)
  }

  // A source is completed only when every due non-stub detector in it
  // succeeded. Stub detectors are placeholders whose real work runs
  // elsewhere (worker jobs, embedded in another detector). Including them
  // would mark sources like 'quality' and 'link' as completed when no
  // real detector ran, causing reconcile to auto-resolve real findings.
  const stubNames = new Set(dueDetectors.filter((d) => d.stub).map((d) => d.name))
  const sourceDetectors = new Map<HealthSource, { total: number; succeeded: number }>()
  for (const detector of dueDetectors) {
    if (stubNames.has(detector.name)) continue
    const source = DETECTOR_SOURCE[detector.name]
    const entry = sourceDetectors.get(source) ?? { total: 0, succeeded: 0 }
    entry.total += 1
    sourceDetectors.set(source, entry)
  }
  for (const result of results) {
    if (stubNames.has(result.name)) continue
    const source = DETECTOR_SOURCE[result.name]
    const entry = sourceDetectors.get(source)
    if (entry && result.status === 'ok') {
      entry.succeeded += 1
    }
  }

  const completedSources: HealthSource[] = []
  for (const [source, counts] of sourceDetectors) {
    if (counts.total > 0 && counts.total === counts.succeeded) {
      completedSources.push(source)
    }
  }

  return { results, completedSources }
}
