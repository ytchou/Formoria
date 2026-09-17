/**
 * Ledger lifecycle — claims runs, enqueues findings, manages fix lifecycle.
 *
 * Re-implements the DB interactions from `scripts/health-agent/adapters.ts`
 * against the same Postgres RPC functions but with a dependency-injected
 * client so the code runs in plain Node (no Next.js API).
 *
 * Client is injected — `createServiceClient()` is called only in `run.ts`.
 */

import type { HealthFinding, HealthSource, JsonValue } from './contracts'

// ---------------------------------------------------------------------------
// Client type — minimal Supabase surface
// ---------------------------------------------------------------------------

export type HealthLedgerClient = {
  rpc: (
    fn: string,
    params: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: unknown }>
  from: (table: string) => {
    select: (columns: string) => {
      order: (column: string, options?: { ascending: boolean }) => {
        eq: (column: string, value: unknown) => {
          range: (from: number, to: number) => Promise<{ data: unknown[] | null; error: unknown }>
        }
        is: (column: string, value: unknown) => {
          range: (from: number, to: number) => Promise<{ data: unknown[] | null; error: unknown }>
        }
        in: (column: string, values: unknown[]) => {
          range: (from: number, to: number) => Promise<{ data: unknown[] | null; error: unknown }>
        }
        range: (from: number, to: number) => Promise<{ data: unknown[] | null; error: unknown }>
      }
    }
    update: (data: Record<string, unknown>) => {
      eq: (column: string, value: unknown) => {
        select: () => Promise<{ data: unknown[] | null; error: unknown }>
      }
      in: (column: string, values: unknown[]) => {
        is: (column: string, value: unknown) => {
          select: () => Promise<{ data: unknown[] | null; error: unknown }>
        }
        select: () => Promise<{ data: unknown[] | null; error: unknown }>
      }
      is: (column: string, value: unknown) => {
        select: () => Promise<{ data: unknown[] | null; error: unknown }>
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Lease owner
// ---------------------------------------------------------------------------

/**
 * Build the canonical lease owner / run ID string.
 * Format: `railway:health-agent:<uuid>`
 */
export function leaseOwnerString(runId: string): string {
  return `railway:health-agent:${runId}`
}

// ---------------------------------------------------------------------------
// admitRun
// ---------------------------------------------------------------------------

export type AdmitRunInput = {
  routine: string
  logicalDate: string
  runId: string
  workflowAttempt: number
  dryRun: boolean
}

export type AdmitRunResult = {
  claimed: boolean
  replay: boolean
  result?: unknown
  run?: unknown
}

/**
 * Claim a run slot in the ledger. Returns `{ claimed: true }` on success,
 * or `{ claimed: false, replay: true, result }` when the ledger already
 * completed today.
 */
export async function admitRun(
  client: HealthLedgerClient,
  input: AdmitRunInput,
): Promise<AdmitRunResult> {
  const requestedRunId = leaseOwnerString(input.runId)

  const { data, error } = await client.rpc('claim_health_agent_run', {
    p_routine: input.routine,
    p_logical_date: input.logicalDate,
    p_requested_run_id: requestedRunId,
    p_workflow_attempt: input.workflowAttempt,
    p_dry_run: input.dryRun,
  })

  if (error) throw error

  // PostgREST returns the scalar jsonb as a plain object.
  const result = data as Record<string, unknown>
  return {
    claimed: result.claimed === true,
    replay: result.replay === true,
    result: result.result,
    run: result.run,
  }
}

// ---------------------------------------------------------------------------
// completeRun / failRun
// ---------------------------------------------------------------------------

export async function completeRun(
  client: HealthLedgerClient,
  input: {
    routine: string
    logicalDate: string
    runId: string
    workflowAttempt: number
    result: Record<string, JsonValue>
  },
): Promise<boolean> {
  const { data, error } = await client.rpc('complete_health_agent_run', {
    p_routine: input.routine,
    p_logical_date: input.logicalDate,
    p_requested_run_id: leaseOwnerString(input.runId),
    p_workflow_attempt: input.workflowAttempt,
    p_result: input.result,
  })
  if (error) throw error
  return data === true
}

export async function failRun(
  client: HealthLedgerClient,
  input: {
    routine: string
    logicalDate: string
    runId: string
    workflowAttempt: number
    errorMessage: string
    result?: Record<string, JsonValue>
  },
): Promise<boolean> {
  const { data, error } = await client.rpc('fail_health_agent_run', {
    p_routine: input.routine,
    p_logical_date: input.logicalDate,
    p_requested_run_id: leaseOwnerString(input.runId),
    p_workflow_attempt: input.workflowAttempt,
    p_error: input.errorMessage,
    p_result: input.result ?? null,
  })
  if (error) throw error
  return data === true
}

// ---------------------------------------------------------------------------
// enqueueFindings
// ---------------------------------------------------------------------------

/**
 * Enqueue health findings into the fix queue.
 * Sends NULL (not empty string) for a missing sentry issue ID.
 */
export async function enqueueFindings(
  client: HealthLedgerClient,
  findings: HealthFinding[],
): Promise<string[]> {
  const ids: string[] = []

  for (const finding of findings) {
    const { data, error } = await client.rpc('enqueue_health_fix', {
      p_source: finding.source,
      p_fingerprint: finding.fingerprint,
      p_evidence: finding.evidence,
      p_merge_policy: finding.mergePolicy,
      p_title: finding.title,
      // NULL, not empty string, for missing sentry issue ID
      p_sentry_issue_id: finding.sentryIssueId ?? null,
      p_url: null,
    })

    if (error) throw error
    ids.push(data as string)
  }

  return ids
}

// ---------------------------------------------------------------------------
// reserveTickets / finalizeTickets / releaseFailedReservations
// ---------------------------------------------------------------------------

/**
 * Reserve unticketed findings for ticket creation by setting `ticketed_at`.
 * Throws if the updated row count differs from the requested count.
 */
export async function reserveTickets(
  client: HealthLedgerClient,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return

  const { data, error } = await client
    .from('health_fix_queue')
    .update({ ticketed_at: new Date().toISOString() })
    .in('id', ids)
    .is('ticketed_at', null)
    .select()

  if (error) throw error

  const updated = (data as unknown[] | null)?.length ?? 0
  if (updated !== ids.length) {
    throw new Error(
      `reserveTickets: expected ${ids.length} rows updated but got ${updated}`,
    )
  }
}

/**
 * Finalize ticket creation by writing the Linear identifier.
 * Called after the ticket was successfully created in Linear.
 */
export async function finalizeTickets(
  client: HealthLedgerClient,
  updates: Array<{ id: string; linearIdentifier: string }>,
): Promise<void> {
  for (const update of updates) {
    const { error } = await client
      .from('health_fix_queue')
      .update({
        linear_identifier: update.linearIdentifier,
        ticketed_at: new Date().toISOString(),
      })
      .eq('id', update.id)
      .select()

    if (error) throw error
  }
}

/**
 * Release reservations for findings whose ticket creation failed.
 * Nulls out `linear_identifier` and `ticketed_at` for the given IDs.
 */
export async function releaseFailedReservations(
  client: HealthLedgerClient,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return

  const { error } = await client
    .from('health_fix_queue')
    .update({ linear_identifier: null, ticketed_at: null })
    .in('id', ids)
    .select()

  if (error) throw error
}

// ---------------------------------------------------------------------------
// reconcile
// ---------------------------------------------------------------------------

export type ReconcileResult = Array<{
  id: string
  fingerprint: string
  reconciliation: string
  sentry_issue_id: string | null
}>

/**
 * Pass completed sources and observed fingerprints to the reconciliation RPC.
 */
export async function reconcile(
  client: HealthLedgerClient,
  input: {
    completedSources: HealthSource[]
    observedFingerprints: string[]
  },
): Promise<ReconcileResult> {
  const { data, error } = await client.rpc('reconcile_health_fix_lifecycle', {
    p_observed_fingerprints: input.observedFingerprints,
    p_completed_sources: input.completedSources,
  })

  if (error) throw error
  return (data as ReconcileResult) ?? []
}

// ---------------------------------------------------------------------------
// resolveSentryAbsences
// ---------------------------------------------------------------------------

type SentryAbsence = {
  id: string
  fingerprint: string
  sentryIssueId: string
  currentStatus: string
}

type SentryResolver = {
  resolve: (issueIds: readonly string[]) => Promise<number>
}

/**
 * Resolve Sentry issues first, then call verify_health_fix_absence.
 * A failed Sentry resolve skips the verify call for that issue.
 */
export async function resolveSentryAbsences(
  client: HealthLedgerClient,
  sentryResolver: SentryResolver,
  absences: SentryAbsence[],
): Promise<void> {
  for (const absence of absences) {
    // Step 1: resolve in Sentry first
    try {
      await sentryResolver.resolve([absence.sentryIssueId])
    } catch {
      // A failed Sentry resolve skips the verify call
      continue
    }

    // Step 2: verify absence in the DB
    await client.rpc('verify_health_fix_absence', {
      p_id: absence.id,
      p_expected_status: absence.currentStatus,
    })
  }
}

// ---------------------------------------------------------------------------
// releaseClaims
// ---------------------------------------------------------------------------

/**
 * Release any still-claimed rows for this lease owner.
 * Uses the exact same lease owner string that claimed them.
 */
export async function releaseClaims(
  client: HealthLedgerClient,
  leaseOwner: string,
): Promise<void> {
  const { error } = await client.rpc('release_health_fix_claims', {
    p_lease_owner: leaseOwner,
  })
  if (error) throw error
}

// ---------------------------------------------------------------------------
// recordSnapshot
// ---------------------------------------------------------------------------

export async function recordSnapshot(
  client: HealthLedgerClient,
  date: string,
  metrics: Record<string, JsonValue>,
): Promise<void> {
  const { error } = await client.rpc('record_health_snapshot', {
    p_snapshot_date: date,
    p_metrics: metrics,
  })
  if (error) throw error
}
