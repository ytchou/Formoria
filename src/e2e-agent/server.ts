/**
 * E2E nightly agent entry point — Railway service entry.
 *
 * `bootWorker` is awaited BEFORE any `await import('@/lib/services/…')`.
 * `process.exit` in `finally` — 0 on green, 1 on crash.
 *
 * Cron schedule is a Railway dashboard setting,
 * documented in railway/e2e-agent.json.
 */

import { randomUUID } from 'node:crypto'
import { bootWorker, logWorkerBuildInfo } from '@/worker-boot'

// ---------------------------------------------------------------------------
// Dynamic imports — populated after bootWorker
// ---------------------------------------------------------------------------

// TODO: Wire runE2eSuite from @/e2e-agent/runner (Task 6)
let runE2eSuite: Awaited<
  typeof import('@/e2e-agent/runner')
>['runE2eSuite'] | undefined

// TODO: Wire self-heal graph from @/lib/services/e2e-agent/graph (Task 9)
// let runSelfHealGraph: ...

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function main(): Promise<never> {
  logWorkerBuildInfo('e2e-nightly')

  const runId = randomUUID()
  console.log(`[e2e-nightly] run=${runId}`)

  let exitCode = 0

  try {
    // TODO (Task 6): Call runE2eSuite() and inspect failures
    // TODO (Task 9): If failures, call self-heal graph
    // const result = await runE2eSuite({ runId, ... })
    // if (result.failures.length > 0) { ... }

    if (runE2eSuite) {
      // Placeholder — will be wired by Task 6
      void runE2eSuite
    }

    console.log(`[e2e-nightly] run=${runId} outcome=green exit=0`)
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
    async loadServices() {
      // Task 6 will populate this:
      // ;({ runE2eSuite } = await import('@/e2e-agent/runner'))
      // Task 9 will wire the graph:
      // ;({ runSelfHealGraph } = await import('@/lib/services/e2e-agent/graph'))
    },
  })

  void main()
} catch (err) {
  console.error('[e2e-nightly] unrecoverable boot failure:', err)
  process.exit(1)
}
