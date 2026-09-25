/**
 * Repair request types — the payload sent to the ops-agent to trigger
 * automated repairs for health findings.
 *
 * The ops-agent receives this as a structured JSON block inside a Slack
 * message, parses it, and dispatches the appropriate repair workflow.
 */

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
  timeline?: { channel: string; ts: string }
}
