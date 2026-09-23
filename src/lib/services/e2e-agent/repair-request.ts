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
import { freezeFailures } from './freeze'

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

type FailureKind = 'failure' | 'unexpected_skip'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Per-error cap so the whole message stays under Slack's text limit. */
export const MAX_ERROR_CHARS = 1500

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
function sanitizeError(error: string): string {
  const unfenced = error.replace(/```/g, "'''")
  return unfenced.length > MAX_ERROR_CHARS
    ? `${unfenced.slice(0, MAX_ERROR_CHARS)}\n...[truncated]`
    : unfenced
}

/** Mirrors the canonical identity freeze.ts dedupes on. */
function identityKey(f: {
  file: string | null
  title: string
  project: string
}): string {
  return JSON.stringify({
    file: f.file?.trim() || null,
    title: f.title.trim(),
    project: f.project.trim(),
  })
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Freeze the run's failures and unexpected skips into a RepairRequest.
 * Returns null when there is nothing to repair (freeze rejects an empty set,
 * and the ops agent rejects a request with no findings).
 */
export function buildE2eRepairRequest(
  input: E2eRepairRequestInput,
): RepairRequest | null {
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
    const key = identityKey(entry)
    if (!kindByKey.has(key)) kindByKey.set(key, entry.kind)
  }

  const frozen = freezeFailures({ failures: entries })

  const findings: RepairFinding[] = frozen.failures.map((f) => ({
    fingerprint: f.id,
    title: f.title,
    severity: 'high',
    source: 'e2e',
    evidence: {
      file: f.file,
      project: f.project,
      error: sanitizeError(f.reason ?? ''),
      kind: kindByKey.get(identityKey(f)) ?? 'failure',
      stagingSha: input.stagingSha,
    },
  }))

  const scope = [
    ...new Set(
      frozen.failures
        .map((f) => f.file)
        .filter((file): file is string => file !== null),
    ),
  ]

  return {
    agent: 'e2e-agent',
    ref: 'staging',
    runId: input.runId,
    scope,
    findings,
  }
}
