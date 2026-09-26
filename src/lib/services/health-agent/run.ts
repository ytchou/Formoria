/**
 * Health agent run orchestrator — the single entry point for the nightly run.
 *
 * Mirrors `src/lib/services/ops-agent/run.ts`: dependency-injected, never
 * imports Next.js API, never throws.
 *
 * Run order:
 *   admitRun → runDetectors → worker jobs (quality/mdx-links) →
 *   consolidate findings → enqueue/reconcile lifecycle →
 *   report-only tickets → digest → repair trigger (fallback tickets when
 *   it is unavailable) → completeRun
 *
 * The run timeline (Slack parent message) gets `started`, `findings`, then
 * `repair_requested` or `completed`. The repair routine owns the rest. A
 * failed trigger ends on `repair_failed`, after any fallback `tickets_filed`.
 *
 * `createServiceClient()` is called ONCE, in the server.ts entry point,
 * and passed to this module via `deps.client`.
 */

import type { AuditContextSeed } from '@/lib/audit/context'
import { stableFingerprint, type HealthFinding } from './contracts'
import type { Detector } from './types'
import type { RepoWorkerClient } from './repo-worker-client'
import {
  RepairPostRejectedError,
  type RepairFinding,
  type RepairRequest,
} from './repair-request'
import {
  nowSeconds,
  type RunEvent,
  type RunTicket,
  type TimelineRef,
} from '@/lib/services/run-timeline/types'
import {
  admitRun,
  completeRun,
  enqueueFindings,
  failRun,
  finalizeTickets,
  leaseOwnerString,
  readActiveSentryFingerprints,
  reconcile,
  releaseClaims,
  releaseFailedReservations,
  reserveTickets,
  type HealthLedgerClient,
} from './lifecycle'
import { runDetectors } from './runner'
import {
  buildDigest,
  buildDigestBlocks,
  buildFindingTicket,
  isTicketEligible,
} from './report'
import { registry as defaultRegistry } from './registry'
import { HEALTH_JOBS, QUALITY_CONTEXT_COMMANDS } from './jobs'
import { evaluateQualityReports } from './detectors/quality'
import type { CommandResult } from '@/repo-worker/jobs'

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

  /** Post the run timeline parent message. Its ts threads every later post. */
  startTimeline?: (date: string, runId: string) => Promise<TimelineRef | null | undefined>

  /** Append an event to the run timeline. */
  appendRunEvent?: (ref: TimelineRef, event: RunEvent) => Promise<unknown>

  /** Post the Slack digest (threaded under the start message). */
  slackPostDigest?: (content: {
    text: string
    blocks: Array<Record<string, unknown>>
  }, threadTs?: string) => Promise<void>

  /** Create a Linear ticket. Absent in dry-run mode. */
  linearCreateTicket?: (spec: {
    title: string
    body: string
    labels: string[]
  }) => Promise<{ identifier: string; url?: string }>

  /**
   * Trigger the ops-agent to repair findings. threadTs threads under the digest.
   * Throws `RepairPostRejectedError` when the post definitely did not land;
   * any other throw means delivery is unknown.
   */
  triggerRepair?: (request: RepairRequest, threadTs?: string) => Promise<void>

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

/** Matches the relay's zod max for `tickets_filed.tickets`. */
const MAX_TIMELINE_TICKETS = 50

type QualityWorkerFailureKind =
  'clone-auth' | 'install' | 'vitest-exec' | 'knip-exec' | 'worker-transport'

function boundedEvidence(value: string | undefined): string | undefined {
  if (!value) return undefined
  return value
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, '[REDACTED]')
    .replace(/\b(?:Bearer|Basic)\s+\S+/gi, '[REDACTED]')
    .replace(/\bgithub_pat_[A-Za-z0-9_]+\b/g, '[REDACTED]')
    .replace(/\bgh[pousr]_[A-Za-z0-9_]+\b/g, '[REDACTED]')
    .slice(0, 500)
}

function qualityWorkerFailure(
  kind: QualityWorkerFailureKind,
  details: {
    stage?: string
    code?: string
    message?: string
    command?: CommandResult
  } = {},
): HealthFinding {
  const evidence: Record<string, string | number | boolean> = {
    failureKind: kind,
  }
  const stage = boundedEvidence(details.stage)
  const code = boundedEvidence(details.code)
  const message = boundedEvidence(details.message)
  const stderr = boundedEvidence(details.command?.stderr)
  if (stage) evidence.stage = stage
  if (code) evidence.code = code
  if (message) evidence.message = message
  if (stderr) evidence.stderr = stderr
  if (details.command) {
    evidence.exitCode = details.command.exitCode
    evidence.timedOut = details.command.timedOut
  }
  return {
    source: 'quality',
    fingerprint: stableFingerprint('quality', 'worker-failure', kind),
    title: `Quality worker failure: ${kind}`,
    severity: 'high',
    evidence,
    mergePolicy: 'human',
  }
}

function parseJsonOutput(stdout: string): unknown {
  const trimmed = stdout.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    const lines = trimmed.split('\n')
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const candidate = lines.slice(index).join('\n').trim()
      if (!candidate.startsWith('{')) continue
      try {
        return JSON.parse(candidate)
      } catch {
        /* try the previous line */
      }
    }
  }
  return undefined
}

function findCommand(
  results: CommandResult[],
  id: string,
): CommandResult | undefined {
  return results.find((result) => result.id === id)
}

function workerFailureKind(
  stage: string | undefined,
): QualityWorkerFailureKind {
  if (stage === 'clone' || stage === 'clone-auth') return 'clone-auth'
  if (stage === 'install') return 'install'
  return 'worker-transport'
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
    { classifySentryIssue },
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
    import('@/lib/services/health-agent/classifiers/sentry-classify'),
    import('@/lib/services/link-checks/check-url'),
    import('@/lib/services/link-checks/social'),
    import('@/lib/services/link-checks/brand-other-urls'),
    import('@/lib/services/link-checks/brand-channels'),
    import('@/lib/services/link-checks/events'),
    import('@/lib/services/link-checks/brand-images'),
    import('@/lib/services/link-checks/curated-products'),
    import('@/lib/services/link-checks/mdx'),
  ])

  // ---- 2.5. Start the run timeline ----
  let timeline: TimelineRef | undefined
  if (!dryRun && deps.startTimeline) {
    try {
      timeline = (await deps.startTimeline(logicalDate, runId)) ?? undefined
    } catch (err) {
      console.error('[health-agent] run timeline start failed:', err)
    }
  }
  const threadTs = timeline?.ts

  // No timeline means no appends.
  const appendEvent = async (event: RunEvent): Promise<void> => {
    if (!timeline || !deps.appendRunEvent) return
    try {
      await deps.appendRunEvent(timeline, event)
    } catch (err) {
      console.error(`[health-agent] timeline ${event.kind} append failed:`, err)
    }
  }

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
      classifySentryIssue,
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
  const vitestFindings: HealthFinding[] = []
  const knipFindings: HealthFinding[] = []
  const hasQualityStubs = results.some(
    (result) => result.name === 'vitest' || result.name === 'knip',
  )
  if (!dryRun && deps.workerClient) {
    try {
      const commands = [
        ...QUALITY_CONTEXT_COMMANDS,
        ...HEALTH_JOBS.vitest.commands,
        ...HEALTH_JOBS.knip.commands,
      ]
      const jobResult = await deps.workerClient.run({
        ref: 'staging',
        commands,
        editableFiles: [],
      })

      if (jobResult.status === 'done' && jobResult.results) {
        const repoRootResult = findCommand(jobResult.results, 'repo-root')
        const trackedFilesResult = findCommand(
          jobResult.results,
          'tracked-files',
        )
        const vitestResult = findCommand(jobResult.results, 'vitest')
        const knipResult = findCommand(jobResult.results, 'knip')
        const repoContextValid = Boolean(
          repoRootResult &&
          !repoRootResult.timedOut &&
          repoRootResult.exitCode === 0 &&
          repoRootResult.stdout.trim() &&
          trackedFilesResult &&
          !trackedFilesResult.timedOut &&
          trackedFilesResult.exitCode === 0,
        )

        if (!repoContextValid) {
          const failedContext =
            !repoRootResult ||
            repoRootResult.timedOut ||
            repoRootResult.exitCode !== 0
              ? repoRootResult
              : trackedFilesResult
          vitestFindings.push(
            qualityWorkerFailure('worker-transport', {
              stage: failedContext?.id ?? 'repository-context',
              code: 'repository-context-failed',
              message:
                'Repository root or tracked files could not be collected',
              command: failedContext,
            }),
          )
        }

        const evaluation = evaluateQualityReports({
          repoRoot: repoRootResult?.stdout.trim() ?? '',
          trackedFiles: new Set(
            (trackedFilesResult?.stdout ?? '')
              .split('\n')
              .map((file) => file.trim())
              .filter(Boolean),
          ),
          vitestExitCode: vitestResult?.exitCode ?? 1,
          vitestReport: parseJsonOutput(vitestResult?.stdout ?? ''),
          knipExitCode: knipResult?.exitCode ?? 1,
          knipReport: parseJsonOutput(knipResult?.stdout ?? ''),
        })

        vitestFindings.push(
          ...evaluation.findings.filter(
            (finding) => finding.evidence.check === 'full-unit-suite',
          ),
        )
        knipFindings.push(
          ...evaluation.findings.filter(
            (finding) => finding.evidence.check === 'dead-code',
          ),
        )

        const vitestValid = Boolean(
          vitestResult &&
          !vitestResult.timedOut &&
          evaluation.summary.fullUnitSuite.status === 'success',
        )
        const knipValid = Boolean(
          knipResult &&
          !knipResult.timedOut &&
          evaluation.summary.deadCode.status === 'success',
        )
        if (!vitestValid) {
          vitestFindings.push(
            qualityWorkerFailure('vitest-exec', {
              stage: 'vitest',
              code: vitestResult?.timedOut
                ? 'command-timeout'
                : 'invalid-report',
              message: evaluation.failures.find((failure) =>
                failure.startsWith('full-unit-suite:'),
              ),
              command: vitestResult,
            }),
          )
        }
        if (!knipValid) {
          knipFindings.push(
            qualityWorkerFailure('knip-exec', {
              stage: 'knip',
              code: knipResult?.timedOut ? 'command-timeout' : 'invalid-report',
              message: evaluation.failures.find((failure) =>
                failure.startsWith('dead-code:'),
              ),
              command: knipResult,
            }),
          )
        }
        qualityJobsSucceeded = repoContextValid && vitestValid && knipValid
      } else {
        console.warn(
          `[health-agent] quality jobs returned status: ${jobResult.status}`,
        )
        vitestFindings.push(
          qualityWorkerFailure(workerFailureKind(jobResult.errorStage), {
            stage: jobResult.errorStage,
            code: jobResult.errorCode,
            message: jobResult.error,
          }),
        )
      }
    } catch (err) {
      console.error('[health-agent] quality jobs failed:', err)
      vitestFindings.push(
        qualityWorkerFailure('worker-transport', {
          stage: 'transport',
          code: 'worker-call-threw',
          message: err instanceof Error ? err.message : String(err),
        }),
      )
    }
  } else if (!dryRun && hasQualityStubs) {
    vitestFindings.push(
      qualityWorkerFailure('worker-transport', {
        stage: 'transport',
        code: 'worker-not-configured',
        message: 'REPO_WORKER_URL is not configured',
      }),
    )
  }

  // Inject quality findings into the vitest/knip stub results.
  for (const result of results) {
    if (result.name === 'vitest') result.findings = vitestFindings
    if (result.name === 'knip') result.findings = knipFindings
  }

  if (vitestFindings.length > 0 && !results.some((r) => r.name === 'vitest')) {
    console.warn(
      '[health-agent] vitest stub not found in results — quality findings not injected',
    )
  }
  if (knipFindings.length > 0 && !results.some((r) => r.name === 'knip')) {
    console.warn(
      '[health-agent] knip stub not found in results — quality findings not injected',
    )
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
  const repairableFindings = allFindings.filter(
    (f) => f.disposition !== 'report_only',
  )
  const reportOnlyFindings = allFindings.filter(
    (f) => f.disposition === 'report_only',
  )
  const failedDetectors = results.filter((r) => r.status === 'failed').length
  await appendEvent({
    kind: 'findings',
    at: nowSeconds(),
    total: totalFindings,
    repairable: repairableFindings.length,
    reportOnly: reportOnlyFindings.length,
    ...(failedDetectors > 0 ? { failedDetectors } : {}),
  })
  const sentryFindings = allFindings.filter(
    (finding) =>
      finding.source === 'sentry' && finding.sentryIssueId !== undefined,
  )
  const highlightedSentryFingerprints = new Set<string>()

  // Read before enqueue: enqueue upserts active rows, which would erase the
  // distinction between an existing issue and a new or returned issue.
  if (!dryRun && sentryFindings.length > 0) {
    const activeFingerprints = await readActiveSentryFingerprints(client)
    for (const finding of sentryFindings) {
      if (!activeFingerprints.has(finding.fingerprint)) {
        highlightedSentryFingerprints.add(finding.fingerprint)
      }
    }
  }

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

  // ---- 6. Ticket ledger + report-only tickets (skip in dry-run) ----
  const traceUrl = `https://cloud.langfuse.com/trace/${runId}`

  // Build fingerprint -> queue-entry-ID map from enqueue results
  const fingerprintToId = new Map<string, string>()
  for (let i = 0; i < allFindings.length && i < enqueuedIds.length; i++) {
    fingerprintToId.set(allFindings[i].fingerprint, enqueuedIds[i])
  }

  // Which enqueued entries are already ticketed, and under which identifier
  const alreadyTicketed = new Set<string>()
  const linearIdentifiers = new Map<string, string>()
  let ledgerRead = false
  if (!dryRun && enqueuedIds.length > 0) {
    try {
      const { data: queueRows, error: ledgerError } = await client
        .from('health_fix_queue')
        .select('id,fingerprint,ticketed_at,linear_identifier')
        .order('created_at', { ascending: false })
        .in('id', enqueuedIds)
        .range(0, enqueuedIds.length - 1)

      if (ledgerError) {
        // Same as a thrown read: ledgerRead stays false, so no ticket is filed
        // this run and repair findings go out without ticketId.
        console.warn('[health-agent] ticket ledger read returned an error:', ledgerError)
      } else {
        for (const row of (queueRows ?? []) as Array<{
          id: string
          fingerprint: string
          ticketed_at: string | null
          linear_identifier: string | null
        }>) {
          if (row.ticketed_at) alreadyTicketed.add(row.fingerprint)
          if (row.linear_identifier) {
            linearIdentifiers.set(row.fingerprint, row.linear_identifier)
          }
        }
        ledgerRead = true
      }
    } catch (err) {
      console.error('[health-agent] ticket ledger read failed:', err)
    }
  }

  // One ticket per new eligible finding: reserve -> create -> finalize,
  // releasing the reservation on failure. Created tickets are listed under
  // "Needs you" through one tickets_filed event per call.
  const fileFindingTickets = async (findings: HealthFinding[]): Promise<void> => {
    const createTicket = deps.linearCreateTicket
    if (dryRun || !createTicket || !ledgerRead) return
    const filed: RunTicket[] = []
    for (const finding of findings) {
      if (!isTicketEligible(finding, alreadyTicketed)) continue
      const queueId = fingerprintToId.get(finding.fingerprint)
      if (!queueId) continue
      // Mark before the attempt so a duplicate fingerprint is never retried.
      alreadyTicketed.add(finding.fingerprint)

      const ticket = buildFindingTicket(finding, { traceUrl, date: logicalDate })
      try {
        await reserveTickets(client, [queueId])
      } catch (err) {
        console.error('[health-agent] reserveTickets failed:', err)
        continue
      }

      try {
        const result = await createTicket({
          title: ticket.title,
          body: ticket.body,
          labels: ticket.labels,
        })
        await finalizeTickets(client, [
          { id: queueId, linearIdentifier: result.identifier },
        ])
        // No URL, no row: no existing src/ code builds Linear issue links (the
        // workspace slug is not configured), so a ticket without one is left
        // out of the timeline. It is still in Linear and in the ledger.
        // No fingerprints: only the relay write-back needs them, and they
        // bloat the Slack metadata.
        if (result.url) {
          filed.push({
            id: result.identifier,
            url: result.url,
            title: finding.title,
          })
        }
      } catch (err) {
        console.error('[health-agent] ticket creation failed:', err)
        try {
          await releaseFailedReservations(client, [queueId])
        } catch { /* release best-effort */ }
      }
    }
    if (filed.length > 0) {
      // shortcut: cap 50 tickets per event to bound Slack metadata size; the rest are still filed in Linear, just not listed under Needs you. Upgrade: an 'N more' marker.
      await appendEvent({
        kind: 'tickets_filed',
        at: nowSeconds(),
        tickets: filed.slice(0, MAX_TIMELINE_TICKETS),
      })
    }
  }

  // shortcut: one ticket per report-only finding; the first night after a new detector ships can file many. Upgrade path: group by detector.
  await fileFindingTickets(reportOnlyFindings)

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
      const digestOptions = {
        date: logicalDate,
        traceUrl,
        runId,
        highlightedFingerprints: highlightedSentryFingerprints,
      }
      const digestText = buildDigest(results, digestOptions)
      const digestBlocks = buildDigestBlocks(results, digestOptions)
      await deps.slackPostDigest({ text: digestText, blocks: digestBlocks }, threadTs)
    } catch (err) {
      console.error('[health-agent] digest failed:', err)
      digestFailed = true
    }
  }

  // ---- 9.5. Repair trigger (Slack → ops-agent) ----
  // The repair routine owns tickets for the findings it receives. When the
  // trigger is unconfigured or Slack definitely rejected the post, the health
  // agent files them instead, so no finding goes without a ticket. The
  // timeline never ends on `tickets_filed`: a failed trigger ends on
  // `repair_failed`, an unconfigured one on `completed`.
  if (!dryRun) {
    if (repairableFindings.length === 0) {
      await appendEvent({ kind: 'completed', at: nowSeconds() })
    } else if (deps.triggerRepair) {
      const repairRequest: RepairRequest = {
        agent: 'ops-agent',
        ref: 'staging',
        runId,
        traceUrl,
        scope: [...new Set(repairableFindings.flatMap(
          (f) => f.changedFiles ?? [],
        ))],
        findings: repairableFindings.map((f): RepairFinding => {
          const ticketId = linearIdentifiers.get(f.fingerprint)
          return {
            fingerprint: f.fingerprint,
            title: f.title,
            severity: f.severity,
            source: f.source,
            ...(ticketId ? { ticketId } : {}),
            ...(typeof f.evidence.rootCause === 'string'
              ? { rootCause: f.evidence.rootCause }
              : {}),
            ...(typeof f.evidence.permalink === 'string'
              ? { permalink: f.evidence.permalink }
              : {}),
            evidence: f.evidence,
          }
        }),
        ...(timeline ? { timeline } : {}),
      }
      await appendEvent({ kind: 'repair_requested', at: nowSeconds() })
      try {
        await deps.triggerRepair(repairRequest, threadTs)
        console.log(
          `[health-agent] repair trigger sent for ${repairableFindings.length} findings`,
        )
      } catch (err) {
        // Repair trigger failure is independent — does NOT set digestFailed
        console.error('[health-agent] repair trigger failed:', err)
        if (err instanceof RepairPostRejectedError) {
          // Definite: the routine never saw the request.
          await fileFindingTickets(repairableFindings)
        } else {
          // ambiguous: the post may have been delivered; the routine tickets, and ticketed_at stays NULL so tomorrow's run re-sends if not.
        }
        await appendEvent({
          kind: 'repair_failed',
          at: nowSeconds(),
          reason: err instanceof Error ? err.message : String(err),
        })
      }
    } else {
      // Unconfigured trigger: nothing further will happen for this run.
      await fileFindingTickets(repairableFindings)
      await appendEvent({ kind: 'completed', at: nowSeconds() })
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
