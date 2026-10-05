/**
 * Health agent run orchestrator — the single entry point for the nightly run.
 *
 * Mirrors `src/lib/services/ops-agent/run.ts`: dependency-injected, never
 * imports Next.js API, never throws.
 *
 * Run order:
 *   admitRun → runDetectors → worker jobs (quality/mdx-links) →
 *   consolidate findings → enqueue/reconcile lifecycle →
 *   ticket-route tickets → digest → auto-fix trigger (fallback tickets when
 *   it is unavailable) → completeRun
 *
 * Routing: a finding goes to the auto-fix routine only when its detector opts
 * in (`routeOf`); everything else is ticketed. Acknowledged known debt
 * (`HEALTH_ACKNOWLEDGEMENTS`) is enqueued but takes neither route.
 *
 * The run timeline (Slack parent message) gets `started`, `findings`, then
 * `ticket_outcomes`, then `repair_requested` or `completed`. The repair
 * routine owns the rest. A failed trigger ends on `repair_failed`, after any
 * fallback `ticket_outcomes` (bucket `auto_fix`).
 *
 * `createServiceClient()` is called ONCE, in the server.ts entry point,
 * and passed to this module via `deps.client`.
 */

import type { AuditContextSeed } from '@/lib/audit/context'
import { routeOf, stableFingerprint, type HealthFinding } from './contracts'
import {
  isAcknowledged,
  type HealthAcknowledgement,
} from '@/lib/constants/health-acknowledgements'
import { HEALTH_TICKET_FOLLOW_UP_DAYS } from '@/lib/constants/health-detectors'
import { truncatePlain } from '@/lib/adapters/slack/blocks'
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
  type TicketOutcome,
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
  reserveTicket,
  undoReservation,
  type HealthLedgerClient,
} from './lifecycle'
import { runDetectors } from './runner'
import {
  buildDigest,
  buildDigestBlocks,
  buildFindingTicket,
  daysSinceTicketed,
  isTicketEligible,
  type TicketLedgerEntry,
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
   * Read the workflow state of existing tickets, keyed by the requested
   * identifier; `closed` means completed or canceled. Absent when Linear is
   * unconfigured; a throw leaves the states unknown.
   */
  linearGetTicketStates?: (
    identifiers: readonly string[],
  ) => Promise<Map<string, { state: string; closed: boolean }>>

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

  /** Clock for the stale-ticket follow-up window. Defaults to `new Date()`. */
  now?: () => Date

  /** Override the acknowledged-debt list for tests. Defaults to `HEALTH_ACKNOWLEDGEMENTS`. */
  acknowledgements?: readonly HealthAcknowledgement[]
}

export type RunHealthAgentResult = {
  status: 'completed' | 'replay' | 'failed'
  dryRun: boolean
  exitCode: number
  totalFindings: number
  prPublished?: boolean
  error?: string
}

/**
 * Caps the items listed in one `ticket_outcomes` event to bound Slack
 * metadata size. The relay does not validate this event; only this cap and
 * OUTCOME_TITLE_LIMIT bound it.
 */
const MAX_TIMELINE_TICKETS = 50

/** Bounds an item title stored in Slack metadata (the Linear ticket keeps the full title). */
const OUTCOME_TITLE_LIMIT = 120

/** Bounds an error message stored in Slack metadata. */
const OUTCOME_REASON_LIMIT = 200

const DAY_MS = 86_400_000

type QualityWorkerFailureKind =
  'clone-auth' | 'install' | 'vitest-exec' | 'knip-exec' | 'worker-transport'

/** Header Vitest prints before its unhandled-errors block on stderr. */
const VITEST_UNHANDLED_HEADER = 'Unhandled Errors'

/**
 * Fits Vitest's unhandled-errors block: header, error, stack, origin file. A
 * real in-test leak measured ~1,500 chars and the origin line comes after the
 * stack, so the cap leaves room for deeper stacks.
 */
const VITEST_UNHANDLED_LIMIT = 4000

function boundedEvidence(
  value: string | undefined,
  keep: 'head' | 'tail' | 'stderr' = 'head',
): string | undefined {
  if (!value) return undefined
  const redacted = value
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, '[REDACTED]')
    .replace(/\b(?:Bearer|Basic)\s+\S+/gi, '[REDACTED]')
    .replace(/\bgithub_pat_[A-Za-z0-9_]+\b/g, '[REDACTED]')
    .replace(/\bgh[pousr]_[A-Za-z0-9_]+\b/g, '[REDACTED]')
  if (keep === 'stderr') {
    const header = redacted.lastIndexOf(VITEST_UNHANDLED_HEADER)
    if (header >= 0) {
      return redacted.slice(header, header + VITEST_UNHANDLED_LIMIT)
    }
  }
  return keep === 'head' ? redacted.slice(0, 500) : redacted.slice(-500)
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
  // A command reports its failure last; the head is setup noise. Vitest's
  // unhandled-errors block ends in ~460 chars of fixed text that would fill a
  // 500-char tail, so that block is kept from its header instead (DEV-1931).
  const stderr = boundedEvidence(details.command?.stderr, 'stderr')
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
          const vitestFailure = evaluation.failures.find((failure) =>
            failure.startsWith('full-unit-suite:'),
          )
          vitestFindings.push(
            qualityWorkerFailure('vitest-exec', {
              stage: 'vitest',
              code: vitestResult?.timedOut
                ? 'command-timeout'
                : vitestFailure === 'full-unit-suite:nonzero_exit_without_failures'
                  ? 'nonzero-exit-without-failures'
                  : 'invalid-report',
              message: vitestFailure,
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
  // Acknowledged known debt is still enqueued (reconcile closes it by
  // detector absence) but takes neither route.
  const acknowledgedGroups = new Map<
    string,
    { ticket: string; until: string; count: number }
  >()
  const routedFindings: HealthFinding[] = []
  for (const f of allFindings) {
    const acknowledgement = isAcknowledged(f.fingerprint, logicalDate, deps.acknowledgements)
    if (!acknowledgement) {
      routedFindings.push(f)
      continue
    }
    const group = acknowledgedGroups.get(acknowledgement.ticket)
    if (!group) {
      acknowledgedGroups.set(acknowledgement.ticket, {
        ticket: acknowledgement.ticket,
        until: acknowledgement.until,
        count: 1,
      })
    } else {
      group.count += 1
      // Two entries under one ticket: the soonest expiry is the one to warn about.
      if (acknowledgement.until < group.until) group.until = acknowledgement.until
    }
  }
  const acknowledgedCount = totalFindings - routedFindings.length
  const autoFixFindings = routedFindings.filter(
    (f) => routeOf(f) === 'auto_fix',
  )
  const ticketFindings = routedFindings.filter(
    (f) => routeOf(f) === 'ticket',
  )
  const failedDetectorNames = results
    .filter((r) => r.status === 'failed')
    .map((r) => r.name)
  const failedDetectors = failedDetectorNames.length
  await appendEvent({
    kind: 'findings',
    at: nowSeconds(),
    total: totalFindings,
    autoFix: autoFixFindings.length,
    ticket: ticketFindings.length,
    ...(acknowledgedCount > 0
      ? {
          acknowledged: acknowledgedCount,
          acknowledgedGroups: [...acknowledgedGroups.values()],
        }
      : {}),
    ...(failedDetectors > 0 ? { failedDetectors, failedDetectorNames } : {}),
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

  // ---- 6. Ticket ledger + ticket-route tickets (skip in dry-run) ----
  const traceUrl = `https://cloud.langfuse.com/trace/${runId}`

  // Build fingerprint -> queue-entry-ID map from enqueue results
  const fingerprintToId = new Map<string, string>()
  for (let i = 0; i < allFindings.length && i < enqueuedIds.length; i++) {
    fingerprintToId.set(allFindings[i].fingerprint, enqueuedIds[i])
  }

  // Which enqueued entries are already ticketed, when, and under which identifier
  const ticketLedger = new Map<string, TicketLedgerEntry>()
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
          if (row.ticketed_at) {
            ticketLedger.set(row.fingerprint, {
              ticketedAt: row.ticketed_at,
              linearIdentifier: row.linear_identifier,
            })
          }
        }
        ledgerRead = true
      }
    } catch (err) {
      console.error('[health-agent] ticket ledger read failed:', err)
    }
  }

  // One ticket per eligible finding: reserve -> create -> finalize, undoing
  // the reservation only when the ticket was never created. A finding ticketed more than
  // HEALTH_TICKET_FOLLOW_UP_DAYS ago that still fires gets a follow-up ticket.
  // Every routed finding gets one outcome item, appended as one
  // ticket_outcomes event per call.
  const now = deps.now?.() ?? new Date()
  const attempted = new Set<string>()

  /** Why `isTicketEligible` turned the finding down, or the ticket it already has. */
  const ineligibleOutcome = (finding: HealthFinding): TicketOutcome => {
    const title = truncatePlain(finding.title, OUTCOME_TITLE_LIMIT)
    if (finding.source === 'sentry') {
      return { title, outcome: 'not_eligible', reason: 'Sentry issues are signal-only' }
    }
    const entry = ticketLedger.get(finding.fingerprint)
    if (!entry?.linearIdentifier) {
      return {
        title,
        outcome: 'not_eligible',
        reason: 'ticketed with no Linear identifier',
      }
    }
    const ticketedMs = Date.parse(entry.ticketedAt)
    return {
      title,
      outcome: 'existing',
      ticketId: entry.linearIdentifier,
      ticketedAt: entry.ticketedAt,
      ...(Number.isNaN(ticketedMs)
        ? {}
        : {
            followUpOn: new Date(
              ticketedMs + HEALTH_TICKET_FOLLOW_UP_DAYS * DAY_MS,
            ).toISOString().slice(0, 10),
          }),
    }
  }

  /** Adds the Linear state to `existing` items in one read; a failure leaves it unknown. */
  const addTicketStates = async (items: TicketOutcome[]): Promise<void> => {
    const getStates = deps.linearGetTicketStates
    const identifiers = [...new Set(items.flatMap((item) =>
      item.outcome === 'existing' && item.ticketId ? [item.ticketId] : []))]
    if (!getStates || identifiers.length === 0) return
    let states: Map<string, { state: string; closed: boolean }>
    try {
      states = await getStates(identifiers)
    } catch (err) {
      console.warn('[health-agent] Linear ticket state read failed:', err)
      return
    }
    for (const item of items) {
      const state = item.ticketId ? states.get(item.ticketId) : undefined
      if (item.outcome !== 'existing' || !state) continue
      item.state = state.state
      item.closed = state.closed
    }
  }

  const fileFindingTickets = async (
    findings: HealthFinding[],
    bucket: 'ticket' | 'auto_fix',
  ): Promise<void> => {
    const createTicket = deps.linearCreateTicket
    if (dryRun || !createTicket) return
    const items: TicketOutcome[] = []
    for (const finding of findings) {
      // A duplicate fingerprint is never retried.
      if (attempted.has(finding.fingerprint)) continue
      attempted.add(finding.fingerprint)
      const title = truncatePlain(finding.title, OUTCOME_TITLE_LIMIT)
      if (!ledgerRead) {
        // The ledger read is skipped when nothing was enqueued, so name the enqueue then.
        items.push({
          title,
          outcome: 'not_processed',
          reason: enqueuedIds.length === 0
            ? 'finding was not enqueued'
            : 'ticket ledger read failed',
        })
        continue
      }
      if (!isTicketEligible(finding, ticketLedger, now)) {
        items.push(ineligibleOutcome(finding))
        continue
      }
      const queueId = fingerprintToId.get(finding.fingerprint)
      if (!queueId) {
        items.push({ title, outcome: 'not_processed', reason: 'finding was not enqueued' })
        continue
      }

      const previous = ticketLedger.get(finding.fingerprint)
      const ticket = buildFindingTicket(finding, {
        traceUrl,
        date: logicalDate,
        ...(previous
          ? {
              followUp: {
                previousIdentifier: previous.linearIdentifier,
                daysSinceTicketed: daysSinceTicketed(previous.ticketedAt, now),
              },
            }
          : {}),
      })
      try {
        await reserveTicket(client, queueId, previous)
      } catch (err) {
        console.error('[health-agent] ticket reservation failed:', err)
        items.push({ title, outcome: 'failed', reason: 'ticket reservation failed' })
        continue
      }

      let result: { identifier: string; url?: string }
      try {
        result = await createTicket({
          title: ticket.title,
          body: ticket.body,
          labels: ticket.labels,
        })
      } catch (err) {
        console.error('[health-agent] ticket creation failed:', err)
        try {
          // A follow-up keeps its earlier ticket link rather than clearing it.
          await undoReservation(client, queueId, previous)
        } catch { /* release best-effort */ }
        const message = err instanceof Error ? err.message : String(err)
        items.push({
          title,
          outcome: 'failed',
          reason: `Linear create failed: ${message}`.slice(0, OUTCOME_REASON_LIMIT),
        })
        continue
      }

      try {
        await finalizeTickets(client, [
          { id: queueId, linearIdentifier: result.identifier },
        ])
      } catch (err) {
        // The ticket exists in Linear, so the reservation stays: undoing it
        // would re-file the same ticket next run. Log enough to backfill
        // linear_identifier by hand.
        console.error(
          '[health-agent] ticket finalize failed; backfill linear_identifier:',
          JSON.stringify({
            queueId,
            fingerprint: finding.fingerprint,
            linearIdentifier: result.identifier,
          }),
          err,
        )
      }
      // No URL: no existing src/ code builds Linear issue links (the
      // workspace slug is not configured), so the item names the identifier
      // only. No fingerprints: they bloat the Slack metadata.
      items.push({
        title,
        outcome: previous ? 'follow_up' : 'filed',
        ticketId: result.identifier,
        ...(result.url ? { url: result.url } : {}),
      })
    }
    if (items.length === 0) return
    // shortcut: cap 50 items per event to bound Slack metadata size; the rest are still handled, just not listed. Upgrade: an 'N more' count, or a byte-budget trim in append.ts.
    const listed = items.slice(0, MAX_TIMELINE_TICKETS)
    await addTicketStates(listed)
    await appendEvent({
      kind: 'ticket_outcomes',
      at: nowSeconds(),
      bucket,
      items: listed,
    })
  }

  // shortcut: one ticket per ticket-route finding; the first night after a new detector ships can file many. Upgrade path: group by detector.
  await fileFindingTickets(ticketFindings, 'ticket')

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

  // ---- 9.5. Auto-fix trigger (Slack → ops-agent) ----
  // The repair routine owns tickets for the findings it receives. When the
  // trigger is unconfigured or Slack definitely rejected the post, the health
  // agent files them instead, so no finding goes without a ticket. The
  // timeline never ends on `ticket_outcomes`: a failed trigger ends on
  // `repair_failed`, an unconfigured one on `completed`.
  if (!dryRun) {
    if (autoFixFindings.length === 0) {
      await appendEvent({ kind: 'completed', at: nowSeconds() })
    } else if (deps.triggerRepair) {
      const repairRequest: RepairRequest = {
        agent: 'ops-agent',
        ref: 'staging',
        runId,
        traceUrl,
        scope: [...new Set(autoFixFindings.flatMap(
          (f) => f.changedFiles ?? [],
        ))],
        findings: autoFixFindings.map((f): RepairFinding => {
          const ticketId =
            ticketLedger.get(f.fingerprint)?.linearIdentifier ?? undefined
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
          `[health-agent] repair trigger sent for ${autoFixFindings.length} findings`,
        )
      } catch (err) {
        // Repair trigger failure is independent — does NOT set digestFailed
        console.error('[health-agent] repair trigger failed:', err)
        if (err instanceof RepairPostRejectedError) {
          // Definite: the routine never saw the request.
          await fileFindingTickets(autoFixFindings, 'auto_fix')
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
      await fileFindingTickets(autoFixFindings, 'auto_fix')
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
