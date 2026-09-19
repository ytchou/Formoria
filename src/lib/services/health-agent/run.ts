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
import { stableFingerprint, type HealthFinding } from './contracts'
import type { Detector } from './types'
import type { RepoWorkerClient } from './repo-worker-client'
import type { RepairRequest } from './repair-request'
import {
  admitRun,
  completeRun,
  enqueueFindings,
  failRun,
  finalizeTickets,
  leaseOwnerString,
  reconcile,
  releaseClaims,
  releaseFailedReservations,
  reserveTickets,
  type HealthLedgerClient,
} from './lifecycle'
import { runDetectors } from './runner'
import { buildDigest, buildTickets } from './report'
import { registry as defaultRegistry } from './registry'
import { HEALTH_JOBS } from './jobs'
import { parseVitestFindings, parseKnipFindings } from './quality-parsers'

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
  workerClient?: RepoWorkerClient

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

  /** Trigger the ops-agent to repair auto-fixable findings. */
  triggerRepair?: (request: RepairRequest) => Promise<void>

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

  // Fix 3: wrap post-admission work so a throw marks the run as failed
  // and releases the lease instead of leaving it claimed forever.
  const leaseOwner = leaseOwnerString(runId)

  try {
    return await executeRunBody(deps, leaseOwner)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[health-agent] executeRun failed:', err)
    try {
      await failRun(client, {
        routine: 'nightly',
        logicalDate,
        runId,
        workflowAttempt,
        errorMessage: message,
      })
    } catch { /* failRun itself may fail */ }
    try {
      await releaseClaims(client, leaseOwner)
    } catch { /* releaseClaims itself may fail */ }
    return {
      status: 'failed',
      dryRun,
      exitCode: 1,
      totalFindings: 0,
      error: `executeRun failed: ${message}`,
    }
  }
}

/**
 * The inner body of executeRun, extracted so the caller can wrap it
 * in a try/catch for failRun + releaseClaims on unhandled errors.
 */
async function executeRunBody(
  deps: RunHealthAgentDeps,
  _leaseOwner: string,
): Promise<RunHealthAgentResult> {
  const {
    client,
    runId,
    logicalDate,
    workflowAttempt,
    dryRun,
  } = deps

  // ---- 2. Dynamic imports for detector deps ----
  // Loaded after bootWorker (run.ts is itself dynamically imported in
  // server.ts). These are pure service functions — no Next.js API surface.
  const [
    { runLinkHealthCheck },
    { cleanupDeadLinks },
    { listIssues },
    { checkUrl },
    { checkSocialLinks },
    { checkBrandOtherUrls },
    { checkBrandChannelLinks },
    { checkEventLinks },
    { checkBrandImageLinks },
    { checkCuratedProductLinks },
    { checkMdxLinks },
  ] = await Promise.all([
    import('@/lib/services/link-health'),
    import('@/lib/services/link-cleanup'),
    import('@/lib/adapters/sentry/issues'),
    import('@/lib/services/link-checks/check-url'),
    import('@/lib/services/link-checks/social'),
    import('@/lib/services/link-checks/brand-other-urls'),
    import('@/lib/services/link-checks/brand-channels'),
    import('@/lib/services/link-checks/events'),
    import('@/lib/services/link-checks/brand-images'),
    import('@/lib/services/link-checks/curated-products'),
    import('@/lib/services/link-checks/mdx'),
  ])

  // ---- 3. Run detectors ----
  const registryEntries: Detector[] =
    deps.registryOverride ?? Object.values(defaultRegistry)

  const { results, completedSources } = await runDetectors(registryEntries, {
    now: logicalDate,
    concurrency: 4,
    dryRun,
    deps: {
      supabase: client,
      env: process.env,
      fetch: globalThis.fetch,
      fetchFn: globalThis.fetch,
      runLinkHealthCheck,
      cleanupDeadLinks,
      listIssues,
      checkUrl,
      checkSocialLinks,
      checkBrandOtherUrls,
      checkBrandChannelLinks,
      checkEventLinks,
      checkBrandImageLinks,
      checkCuratedProductLinks,
      checkMdxLinks,
      railwayUrl: process.env.FORMORIA_RAILWAY_URL ?? '',
      originSecret: process.env.ORIGIN_SECRET ?? '',
    },
  })

  // ---- 3.5. Quality jobs (vitest + knip via repo worker) ----
  let qualityJobsSucceeded = false
  if (!dryRun && deps.workerClient) {
    try {
      const commands = [
        ...HEALTH_JOBS.vitest.commands,
        ...HEALTH_JOBS.knip.commands,
      ]
      const jobResult = await deps.workerClient.run({
        ref: 'staging',
        commands,
        editableFiles: [],
      })

      let vitestFindings: HealthFinding[] = []
      let knipFindings: HealthFinding[] = []

      if (jobResult.status === 'done' && jobResult.results) {
        vitestFindings = parseVitestFindings(jobResult.results)
        knipFindings = parseKnipFindings(jobResult.results)
        qualityJobsSucceeded = true
      } else {
        console.warn(
          `[health-agent] quality jobs returned status: ${jobResult.status}`,
        )
        // Inject a failure finding so the run doesn't look like all-pass
        const failFinding: HealthFinding = {
          fingerprint: stableFingerprint(
            'quality',
            'worker-failure',
            `quality-jobs-${Date.now()}`,
          ),
          title: `Quality jobs failed (status: ${jobResult.status})`,
          source: 'quality',
          severity: 'high',
          mergePolicy: 'human',
          evidence: {
            stderr:
              jobResult.results?.[0]?.stderr?.slice(0, 500) ?? 'no details',
          },
        }
        vitestFindings = [failFinding]
      }

      // Inject quality findings into the vitest/knip stub results
      for (const r of results) {
        if (r.name === 'vitest') r.findings = vitestFindings
        if (r.name === 'knip') r.findings = knipFindings
      }

      // Warn if stubs are missing — findings would be silently discarded
      if (
        vitestFindings.length > 0 &&
        !results.some((r) => r.name === 'vitest')
      ) {
        console.warn(
          '[health-agent] vitest stub not found in results — quality findings not injected',
        )
      }
      if (
        knipFindings.length > 0 &&
        !results.some((r) => r.name === 'knip')
      ) {
        console.warn(
          '[health-agent] knip stub not found in results — quality findings not injected',
        )
      }
    } catch (err) {
      console.error('[health-agent] quality jobs failed:', err)
      // Stubs stay at [] — detector findings are unaffected
    }
  }

  // Mark quality source as completed when worker jobs succeeded.
  // All quality-source detectors are stubs, so the runner excludes them
  // from completedSources. Without this, reconcile never auto-resolves
  // stale quality findings.
  if (qualityJobsSucceeded && !completedSources.includes('quality')) {
    completedSources.push('quality')
  }

  // Consolidate all findings (after quality jobs so their findings are included)
  const allFindings: HealthFinding[] = results.flatMap((r) => r.findings)
  const totalFindings = allFindings.length

  // ---- 4. Enqueue findings (skip in dry-run) ----
  let enqueuedIds: string[] = []
  if (!dryRun && allFindings.length > 0) {
    try {
      enqueuedIds = await enqueueFindings(client, allFindings)
    } catch (err) {
      console.error('[health-agent] enqueueFindings failed:', err)
    }
  }

  // ---- 5. Reconcile lifecycle (skip in dry-run) ----
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

  // ---- 6. Create tickets (skip in dry-run) ----
  if (!dryRun && deps.linearCreateTicket && enqueuedIds.length > 0) {
    try {
      // Build fingerprint -> queue-entry-ID map from enqueue results
      const fingerprintToId = new Map<string, string>()
      for (let i = 0; i < allFindings.length && i < enqueuedIds.length; i++) {
        fingerprintToId.set(allFindings[i].fingerprint, enqueuedIds[i])
      }

      // Query which enqueued entries are already ticketed
      const { data: queueRows } = await client
        .from('health_fix_queue')
        .select('id,fingerprint,ticketed_at')
        .order('created_at', { ascending: false })
        .in('id', enqueuedIds)
        .range(0, enqueuedIds.length - 1)

      const alreadyTicketed = new Set<string>()
      for (const row of (queueRows ?? []) as Array<{
        id: string
        fingerprint: string
        ticketed_at: string | null
      }>) {
        if (row.ticketed_at) alreadyTicketed.add(row.fingerprint)
      }

      const unticketed = new Set(
        allFindings
          .map((f) => f.fingerprint)
          .filter((fp) => !alreadyTicketed.has(fp)),
      )

      const traceUrl = `https://cloud.langfuse.com/trace/${runId}`
      const tickets = buildTickets(allFindings, {
        unticketed,
        traceUrl,
        groupLinksWeekly: true,
      })

      for (const ticket of tickets) {
        // Resolve queue entry IDs for this ticket's fingerprints
        const queueIds = ticket.fingerprints
          .map((fp) => fingerprintToId.get(fp))
          .filter((id): id is string => id !== undefined)

        if (queueIds.length === 0) continue

        // Reserve -> create -> finalize (release on failure)
        try {
          await reserveTickets(client, queueIds)
        } catch (err) {
          console.error('[health-agent] reserveTickets failed:', err)
          continue
        }

        try {
          const result = await deps.linearCreateTicket({
            title: ticket.title,
            body: ticket.body,
            label: ticket.label,
          })
          await finalizeTickets(
            client,
            queueIds.map((id) => ({
              id,
              linearIdentifier: result.identifier,
            })),
          )
        } catch (err) {
          console.error('[health-agent] ticket creation failed:', err)
          try {
            await releaseFailedReservations(client, queueIds)
          } catch { /* release best-effort */ }
        }
      }
    } catch (err) {
      console.error('[health-agent] ticket lifecycle failed:', err)
    }
  }

  // ---- 7. Worker jobs (knip-fix/repair/PR publishing) ----
  // Quality dispatch (vitest + knip) moved to step 3.5.
  // Ceiling: implement knip-fix, repair dispatch, and PR publishing.

  // ---- 8. Publish PR ----
  // Skipped when githubApp is absent.
  // Ceiling: implement PR publishing when repo-worker is wired.

  // ---- 9. Digest ----
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

  // ---- 9.5. Repair trigger (Slack → ops-agent) ----
  if (!dryRun && deps.triggerRepair) {
    try {
      const repairableFindings = allFindings.filter(
        (f) => f.mergePolicy === 'automatic',
      )
      if (repairableFindings.length > 0) {
        const traceUrl = `https://cloud.langfuse.com/trace/${runId}`
        const repairRequest: RepairRequest = {
          agent: 'ops-agent',
          ref: 'staging',
          runId,
          traceUrl,
          scope: repairableFindings.flatMap(
            (f) => f.changedFiles ?? [],
          ),
          findings: repairableFindings.map((f) => ({
            fingerprint: f.fingerprint,
            title: f.title,
            severity: f.severity,
            source: f.source,
          })),
        }
        await deps.triggerRepair(repairRequest)
        console.log(
          `[health-agent] repair trigger sent for ${repairableFindings.length} findings`,
        )
      }
    } catch (err) {
      // Repair trigger failure is independent — does NOT set digestFailed
      console.error('[health-agent] repair trigger failed:', err)
    }
  }

  // ---- 10. Complete run (skip in dry-run) ----
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
