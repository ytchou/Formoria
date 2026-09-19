/**
 * E2E nightly agent entry point — Railway service entry.
 *
 * `bootWorker` is awaited BEFORE any `await import('@/lib/services/…')`.
 * `process.exit` in `finally` — 0 on green/patched/noise, 1 on needs_human/fallback/crash.
 *
 * Cron schedule is a Railway dashboard setting,
 * documented in railway/e2e-nightly-agent.json.
 */

import { randomUUID } from 'node:crypto'
import { bootWorker, logWorkerBuildInfo } from '@/worker-boot'
import { validateE2eAgentConfig } from '@/e2e-agent/config'

import type { RunOutcome } from '@/lib/services/e2e-agent/types'

// ---------------------------------------------------------------------------
// Dynamic imports — populated after bootWorker
// ---------------------------------------------------------------------------

let runE2eSuite: Awaited<
  typeof import('@/e2e-agent/runner')
>['runE2eSuite'] | undefined

let runSelfHealGraph: Awaited<
  typeof import('@/e2e-agent/self-heal')
>['runSelfHealGraph'] | undefined

let buildRunnerDeps: Awaited<
  typeof import('@/e2e-agent/deps')
>['buildRunnerDeps'] | undefined

let buildSelfHealDeps: Awaited<
  typeof import('@/e2e-agent/deps')
>['buildSelfHealDeps'] | undefined

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function main(): Promise<never> {
  logWorkerBuildInfo('e2e-nightly')

  const runId = randomUUID()
  console.log(`[e2e-nightly] run=${runId}`)

  let exitCode = 0

  try {
    if (!runE2eSuite) {
      throw new Error('runE2eSuite not loaded — loadServices incomplete')
    }

    if (!buildRunnerDeps) {
      throw new Error('buildRunnerDeps not loaded — loadServices incomplete')
    }
    const result = await runE2eSuite({
      runId,
      deps: buildRunnerDeps(),
    })
    const reportableFailures = [
      ...result.failures,
      ...result.unexpectedSkips.map((skip) => ({
        file: skip.file,
        title: skip.title,
        project: skip.project,
        error: 'Test was skipped without a matching expected-skip manifest entry',
      })),
    ]

    if (result.passed) {
      console.log(`[e2e-nightly] run=${runId} outcome=green exit=0`)
    } else if (reportableFailures.length > 0 && runSelfHealGraph) {
      // Map runner failures to freeze.ts RunResult format (requires project)
      if (!buildSelfHealDeps) {
        throw new Error('buildSelfHealDeps not loaded — loadServices incomplete')
      }
      const graphResult = await runSelfHealGraph(
        {
          runResult: {
            failures: reportableFailures.map((f) => ({
              ...f,
              project: f.project ?? 'deep',
            })),
          },
          runId,
          stagingSha: result.stagingSha,
        },
        buildSelfHealDeps(),
      )

      const successOutcomes: RunOutcome[] = ['green', 'patched', 'noise']
      const skipFailureUnresolved =
        result.unexpectedSkips.length > 0 && graphResult.outcome !== 'patched'
      exitCode =
        successOutcomes.includes(graphResult.outcome) && !skipFailureUnresolved
          ? 0
          : 1
      console.log(
        `[e2e-nightly] run=${runId} outcome=${graphResult.outcome} exit=${exitCode}`,
      )
    } else {
      // Failures but no self-heal graph available
      exitCode = 1
      console.log(
        `[e2e-nightly] run=${runId} failures=${result.failures.length} no-selfheal exit=1`,
      )
    }
  } catch (err) {
    console.error('[e2e-nightly] top-level crash:', err)
    exitCode = 1
  } finally {
    process.exit(exitCode)
  }
}

// ---------------------------------------------------------------------------
// Boot — wraps the entire sequence so an unrecoverable boot failure exits 1
// ---------------------------------------------------------------------------

try {
  await bootWorker({
    agent: 'e2e-nightly',
    assertTarget: () => {
      validateE2eAgentConfig()
    },
    async loadServices() {
      ;({ runE2eSuite } = await import('@/e2e-agent/runner'))
      ;({ runSelfHealGraph } = await import('@/e2e-agent/self-heal'))
      ;({ buildRunnerDeps, buildSelfHealDeps } = await import(
        '@/e2e-agent/deps'
      ))
    },
  })

  void main()
} catch (err) {
  console.error('[e2e-nightly] unrecoverable boot failure:', err)
  process.exit(1)
}
