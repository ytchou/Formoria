/**
 * Health agent run orchestrator — the single entry point for the nightly run.
 *
 * Mirrors `src/lib/services/ops-agent/run.ts`: dependency-injected, never
 * imports Next.js API, never throws.
 *
 * Run order:
 *   admitRun → runDetectors → worker jobs (quality/mdx-links) →
 *   consolidate findings → enqueue/reconcile lifecycle →
 *   reserve/create tickets → knip-fix + repair agent → publish PR →
 *   digest → completeRun
 *
 * `createServiceClient()` is called ONCE, in the server.ts entry point,
 * and passed to this module via `deps.client`.
 */

import type { AuditContextSeed } from '@/lib/audit/context'
import type { HealthFinding } from './contracts'
import type { Detector } from './types'
import {
  admitRun,
  completeRun,
  enqueueFindings,
  reconcile,
  type HealthLedgerClient,
} from './lifecycle'
import { runDetectors } from './runner'
import { buildDigest, buildTickets } from './report'
import { registry as defaultRegistry } from './registry'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RunHealthAgentDeps = {
  client: HealthLedgerClient
  runId: string
  logicalDate: string
  workflowAttempt: number
  dryRun: boolean

  /** Override the registry for tests. */
  registryOverride?: Detector[]

  /** Repo worker client — absent means worker unreachable. */
  workerClient?: unknown

  /** GitHub App adapter — for clone tokens and PR creation. */
  githubApp?: unknown

  /** Post the Slack digest. Absent in dry-run mode. */
  slackPostDigest?: (text: string) => Promise<void>

  /** Create a Linear ticket. Absent in dry-run mode. */
  linearCreateTicket?: (spec: {
    title: string
    body: string
    label: string
  }) => Promise<{ identifier: string }>

  /** Report a top-level crash. */
  reportWorkerFailure?: (context: string, error: unknown) => Promise<void>

  /** Audit context wrapper. */
  runWithAuditContext: <T>(seed: AuditContextSeed, fn: () => T) => T

  /** Flush Langfuse before exit. */
  flushLangfuse: () => Promise<void>

  /** Langfuse trace for spans. */
  langfuseTrace?: unknown
}

export type RunHealthAgentResult = {
  status: 'completed' | 'replay' | 'failed'
  dryRun: boolean
  exitCode: number
  totalFindings: number
  prPublished?: boolean
  error?: string
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Run the health agent. Never throws.
 */
export async function runHealthAgent(
  deps: RunHealthAgentDeps,
): Promise<RunHealthAgentResult> {
  // Wrap the entire run in an audit context for Langfuse spans.
  return deps.runWithAuditContext(
    {
      correlationId: deps.runId,
      langfuseTrace: deps.langfuseTrace,
    },
    () => executeRun(deps),
  )
}

async function executeRun(
  deps: RunHealthAgentDeps,
): Promise<RunHealthAgentResult> {
  const {
    client,
    runId,
    logicalDate,
    workflowAttempt,
    dryRun,
  } = deps

  // ---- 1. Admit ----
  let admission
  try {
    admission = await admitRun(client, {
      routine: 'nightly',
      logicalDate,
      runId,
      workflowAttempt,
      dryRun,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      status: 'failed',
      dryRun,
      exitCode: 1,
      totalFindings: 0,
      error: `admitRun failed: ${message}`,
    }
  }

  if (!admission.claimed) {
    if (admission.replay) {
      return {
        status: 'replay',
        dryRun,
        exitCode: 0,
        totalFindings: 0,
      }
    }
    return {
      status: 'failed',
      dryRun,
      exitCode: 1,
      totalFindings: 0,
      error: 'admitRun: not claimed and not a replay',
    }
  }

  // ---- 2. Run detectors ----
  const registryEntries: Detector[] =
    deps.registryOverride ?? Object.values(defaultRegistry)

  const { results, completedSources } = await runDetectors(registryEntries, {
    now: logicalDate,
    concurrency: 4,
    dryRun,
    deps: {
      supabase: client,
    },
  })

  // Consolidate all findings
  const allFindings: HealthFinding[] = results.flatMap((r) => r.findings)
  const totalFindings = allFindings.length

  // ---- 3. Enqueue findings (skip in dry-run) ----
  if (!dryRun && allFindings.length > 0) {
    try {
      await enqueueFindings(client, allFindings)
    } catch (err) {
      console.error('[health-agent] enqueueFindings failed:', err)
    }
  }

  // ---- 4. Reconcile lifecycle (skip in dry-run) ----
  if (!dryRun) {
    try {
      const observedFingerprints = allFindings.map((f) => f.fingerprint)
      await reconcile(client, {
        completedSources,
        observedFingerprints,
      })
    } catch (err) {
      console.error('[health-agent] reconcile failed:', err)
    }
  }

  // ---- 5. Create tickets (skip in dry-run) ----
  if (!dryRun && deps.linearCreateTicket && allFindings.length > 0) {
    try {
      const traceUrl = `https://cloud.langfuse.com/trace/${runId}`
      const unticketed = new Set(allFindings.map((f) => f.fingerprint))
      const tickets = buildTickets(allFindings, {
        unticketed,
        traceUrl,
        groupLinksWeekly: true,
      })

      for (const ticket of tickets) {
        try {
          await deps.linearCreateTicket({
            title: ticket.title,
            body: ticket.body,
            label: ticket.label,
          })
        } catch (err) {
          console.error('[health-agent] ticket creation failed:', err)
        }
      }
    } catch (err) {
      console.error('[health-agent] buildTickets failed:', err)
    }
  }

  // ---- 6. Worker jobs (quality/mdx-links/knip-fix/repair) ----
  // Skipped when workerClient is absent.
  // Ceiling: implement worker job dispatch when repo-worker is wired.

  // ---- 7. Publish PR ----
  // Skipped when githubApp is absent.
  // Ceiling: implement PR publishing when repo-worker is wired.

  // ---- 8. Digest ----
  let digestFailed = false
  if (!dryRun && deps.slackPostDigest) {
    try {
      const traceUrl = `https://cloud.langfuse.com/trace/${runId}`
      const digestText = buildDigest(results, {
        date: logicalDate,
        traceUrl,
      })
      await deps.slackPostDigest(digestText)
    } catch (err) {
      console.error('[health-agent] digest failed:', err)
      digestFailed = true
    }
  }

  // ---- 9. Complete run (skip in dry-run) ----
  if (!dryRun) {
    try {
      await completeRun(client, {
        routine: 'nightly',
        logicalDate,
        runId,
        workflowAttempt,
        result: {
          totalFindings,
          completedSources: [...completedSources],
          detectorCount: results.length,
          failedDetectors: results
            .filter((r) => r.status === 'failed')
            .map((r) => r.name),
        },
      })
    } catch (err) {
      console.error('[health-agent] completeRun failed:', err)
    }
  }

  return {
    status: 'completed',
    dryRun,
    exitCode: digestFailed ? 1 : 0,
    totalFindings,
    prPublished: false,
  }
}
