/**
 * Repair request types — the payload sent to the ops-agent to trigger
 * automated repairs for health findings.
 *
 * The ops-agent receives this as a structured JSON block inside a Slack
 * message, parses it, and dispatches the appropriate repair workflow.
 */

import type { TimelineRef } from '@/lib/services/run-timeline/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RepairFinding = {
  fingerprint: string
  title: string
  severity: string
  source: string
  ticketId?: string
  rootCause?: string
  permalink?: string
  evidence?: Record<string, unknown>
}

export type RepairRequest = {
  agent: string
  ref: string
  runId: string
  traceUrl?: string
  scope: string[]
  findings: RepairFinding[]
  /** Slack parent message of the run timeline; absent on old-format requests. */
  timeline?: TimelineRef
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Slack definitively rejected the repair-trigger post (`{ ok: false }`, e.g.
 * `msg_too_long` or `not_in_channel`): the ops-agent never saw it. Any other
 * error from the trigger is ambiguous: the post may have been delivered.
 */
export class RepairPostRejectedError extends Error {
  readonly slackError: string

  constructor(slackError: string) {
    super(`repair trigger post rejected by Slack: ${slackError}`)
    this.name = 'RepairPostRejectedError'
    this.slackError = slackError
  }
}
