/**
 * Link detector — runs link-health then link-cleanup sequentially.
 *
 * Delegates to the existing `runLinkHealthCheck` and `cleanupDeadLinks`
 * service functions. The detector never throws; failures become findings.
 */

import type { HealthFinding } from '../contracts'
import { stableFingerprint } from '../contracts'
import type { Detector, DetectorContext } from '../types'

// ---------------------------------------------------------------------------
// DI seam — the two service functions are injected so tests can stub them
// without vi.mock.
// ---------------------------------------------------------------------------

export type LinkDetectorDeps = {
  runLinkHealthCheck: (options: {
    dryRun: boolean
    runIdentity: string
  }) => Promise<unknown>
  cleanupDeadLinks: (options: {
    dryRun: boolean
  }) => Promise<unknown>
}

/**
 * The run identity the detector passes to `runLinkHealthCheck`.
 * Must match SAFE_RUN_IDENTITY in link-health.ts:
 * `/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/`
 */
function railwayRunIdentity(date: string): string {
  return `health-agent/${date}`
}

export function linkDetector(deps: LinkDetectorDeps): Detector {
  return {
    name: 'link-health',
    source: 'link',
    schedule: 'nightly',
    severity: 'high',

    async run(ctx: DetectorContext): Promise<HealthFinding[]> {
      const findings: HealthFinding[] = []

      // Step 1: link-health
      try {
        await deps.runLinkHealthCheck({
          dryRun: ctx.dryRun,
          runIdentity: railwayRunIdentity(ctx.date),
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        findings.push({
          source: 'link',
          fingerprint: stableFingerprint('link', 'detector-failure', 'link-health'),
          title: `Link health check failed: ${message}`,
          severity: 'high',
          evidence: { error: message },
          mergePolicy: 'human',
        })
        // Skip cleanup when link-health failed
        return findings
      }

      // Step 2: link-cleanup (only when link-health succeeded)
      try {
        await deps.cleanupDeadLinks({ dryRun: ctx.dryRun })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        findings.push({
          source: 'link',
          fingerprint: stableFingerprint('link', 'detector-failure', 'link-cleanup'),
          title: `Link cleanup failed: ${message}`,
          severity: 'high',
          evidence: { error: message },
          mergePolicy: 'human',
        })
      }

      return findings
    },
  }
}
