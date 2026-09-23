/**
 * Build the ops-agent repair request for a red E2E nightly run.
 *
 * The request is posted into the run's Slack thread (see
 * src/e2e-agent/server.ts); the ops agent parses it with
 * `extractRepairRequest` and fires the Claude routine, which fixes the
 * failures and opens a PR.
 */

import type {
  RepairFinding,
  RepairRequest,
} from '@/lib/services/health-agent/repair-request'
import { canonicalKey, freezeFailures } from './freeze'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RunnerFailure = {
  file: string | null
  title: string
  project?: string
  error?: string
}

type UnexpectedSkip = {
  file: string | null
  title: string
  project: string
  reason?: string
}

export type E2eRepairRequestInput = {
  failures: readonly RunnerFailure[]
  unexpectedSkips: readonly UnexpectedSkip[]
  runId: string
  stagingSha: string
}

export type E2eRepairRequestResult = {
  request: RepairRequest
  /** Trailing findings left out so the request fits in one Slack message. */
  dropped: number
}

type FailureKind = 'failure' | 'unexpected_skip'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Per-error cap when there are few findings. */
export const MAX_ERROR_CHARS = 1500

/** Per-error floor when many findings share the error budget. */
const MIN_ERROR_CHARS = 200

/** Total error characters shared across all findings. */
const ERROR_BUDGET_CHARS = 20_000

/**
 * Cap on the serialized request plus the per-finding title list that
 * buildRepairTriggerMessage prints above it. Slack's chat.postMessage text
 * limit is 40,000 characters; the rest is headroom for the message frame and
 * mrkdwn escaping.
 */
export const MAX_REQUEST_CHARS = 30_000

/** The runner executes a single Playwright project. */
const DEFAULT_PROJECT = 'deep'

const UNEXPECTED_SKIP_ERROR =
  'Test was skipped without a matching expected-skip manifest entry'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Cap the error length and strip triple backticks: the ops agent extracts the
 * JSON block with a non-greedy ``` match, so a fence inside an error string
 * would cut the block short.
 */
function sanitizeError(error: string, maxChars: number): string {
  const unfenced = error.replace(/```/g, "'''")
  return unfenced.length > maxChars
    ? `${unfenced.slice(0, maxChars)}\n...[truncated]`
    : unfenced
}

/** Shrink the per-error cap as the finding count grows. */
function errorCapFor(count: number): number {
  return Math.max(
    MIN_ERROR_CHARS,
    Math.min(MAX_ERROR_CHARS, Math.floor(ERROR_BUDGET_CHARS / count)),
  )
}

/** Serialized JSON plus the title list the trigger message prints. */
function messageSize(request: RepairRequest): number {
  return request.findings.reduce(
    (size, f) => size + f.title.length + 16,
    JSON.stringify(request).length,
  )
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Freeze the run's failures and unexpected skips into a RepairRequest.
 * Returns null when there is nothing to repair (freeze rejects an empty set,
 * and the ops agent rejects a request with no findings).
 *
 * The request is bounded to MAX_REQUEST_CHARS: per-error length shrinks with
 * the finding count, and if that is not enough, trailing findings are dropped
 * (at least one is always kept) and reported in `dropped`.
 */
export function buildE2eRepairRequest(
  input: E2eRepairRequestInput,
): E2eRepairRequestResult | null {
  const entries = [
    ...input.failures.map((f) => ({
      file: f.file,
      title: f.title,
      project: f.project ?? DEFAULT_PROJECT,
      error: f.error ?? '',
      kind: 'failure' as FailureKind,
    })),
    ...input.unexpectedSkips.map((s) => ({
      file: s.file,
      title: s.title,
      project: s.project,
      error: s.reason?.trim() ? s.reason : UNEXPECTED_SKIP_ERROR,
      kind: 'unexpected_skip' as FailureKind,
    })),
  ]

  if (entries.length === 0) return null

  // First entry wins, matching freeze's dedupe order.
  const kindByKey = new Map<string, FailureKind>()
  for (const entry of entries) {
    const key = canonicalKey(entry)
    if (!kindByKey.has(key)) kindByKey.set(key, entry.kind)
  }

  const frozen = freezeFailures({ failures: entries })
  const errorCap = errorCapFor(frozen.failures.length)

  const items = frozen.failures.map((f) => ({
    file: f.file,
    finding: {
      fingerprint: f.id,
      title: f.title,
      severity: 'high',
      source: 'e2e',
      evidence: {
        file: f.file,
        project: f.project,
        error: sanitizeError(f.reason ?? '', errorCap),
        kind: kindByKey.get(canonicalKey(f)) ?? 'failure',
        stagingSha: input.stagingSha,
      },
    } satisfies RepairFinding,
  }))

  const toRequest = (kept: typeof items): RepairRequest => ({
    agent: 'e2e-agent',
    ref: 'staging',
    runId: input.runId,
    scope: [
      ...new Set(
        kept
          .map((item) => item.file)
          .filter((file): file is string => file !== null),
      ),
    ],
    findings: kept.map((item) => item.finding),
  })

  // Linear re-serialization per drop; fine for a nightly run's failure count.
  let kept = items
  let request = toRequest(kept)
  while (kept.length > 1 && messageSize(request) > MAX_REQUEST_CHARS) {
    kept = kept.slice(0, -1)
    request = toRequest(kept)
  }

  return { request, dropped: items.length - kept.length }
}
