export const RUN_TIMELINE_EVENT_TYPE = "formoria_run_timeline";

export type RunTicket = {
  id: string;
  url: string;
  title: string;
  fingerprints?: string[];
};

/** Acknowledged findings sharing one `health-acknowledgements.ts` ticket. */
type AcknowledgedGroup = {
  ticket: string;
  /**
   * Date (YYYY-MM-DD) the acknowledgement lapses, compared with the health
   * agent's logicalDate, which is the Asia/Taipei calendar date.
   */
  until: string;
  count: number;
};

/** What the health agent's ticket step did with one routed finding. */
export type TicketOutcome = {
  title: string;
  /**
   * `not_processed`: nothing was filed; `reason` names why, e.g. the ticket
   * ledger could not be read or the finding was not enqueued.
   */
  outcome:
    | "filed"
    | "follow_up"
    | "existing"
    | "not_eligible"
    | "failed"
    | "not_processed";
  ticketId?: string;
  url?: string;
  /** When the ledger recorded the existing ticket (ISO timestamp). */
  ticketedAt?: string;
  /** Linear workflow state name, e.g. "In Progress" or "Duplicate". */
  state?: string;
  /** Linear state type is completed or canceled. */
  closed?: boolean;
  /** UTC date (YYYY-MM-DD) a follow-up ticket becomes allowed. */
  followUpOn?: string;
  reason?: string;
};

export type RunEvent =
  | { kind: "started"; at: number }
  | {
      kind: "findings";
      at: number;
      // health agent
      total?: number;
      /** Findings sent to the auto-fix routine. */
      autoFix?: number;
      /** Findings routed to a Linear ticket. */
      ticket?: number;
      /** @deprecated legacy persisted field; read `autoFix`. */
      repairable?: number;
      /** @deprecated legacy persisted field; read `ticket`. */
      reportOnly?: number;
      /** Known debt, enqueued but neither ticketed nor auto-fixed. */
      acknowledged?: number;
      /** Detectors that could not run; their sources are missing from `total`. */
      failedDetectors?: number;
      /** Names of the failed detectors, for the Needs you line. */
      failedDetectorNames?: string[];
      /** Acknowledged findings grouped by their acknowledgement ticket. */
      acknowledgedGroups?: AcknowledgedGroup[];
      // e2e agent
      passed?: number;
      failed?: number;
      flaky?: number;
      skipped?: number;
      /** Skips not declared as expected; repaired together with `failed`. */
      unexpectedSkips?: number;
      /** Test-suite duration, which excludes setup; `completed` shows wall-clock time. */
      durationSeconds?: number;
      summary?: string;
    }
  | { kind: "repair_requested"; at: number }
  | { kind: "repair_started"; at: number; sessionUrl?: string }
  | { kind: "repair_failed"; at: number; reason: string }
  | {
      kind: "pr_opened";
      at: number;
      number: number;
      url: string;
      title: string;
      ticketId?: string;
    }
  | { kind: "tickets_filed"; at: number; tickets: RunTicket[] }
  // Health-owned: one item per routed finding of the bucket.
  | {
      kind: "ticket_outcomes";
      at: number;
      bucket: "ticket" | "auto_fix";
      items: TicketOutcome[];
    }
  // Routine-owned: the repair's triage counts, sent before `completed`.
  | {
      kind: "repair_summary";
      at: number;
      total: number;
      fixed: number;
      falsePositive: number;
      ticketed: number;
      /** Fixed on staging but not promoted, so the finding still fires. */
      pendingRelease: number;
      pendingReleaseTickets?: string[];
      notes?: string[];
    }
  | { kind: "completed"; at: number }
  | { kind: "failed"; at: number; outcome: string; reason?: string };

export type RunEventKind = RunEvent["kind"];

export const RUN_EVENT_KINDS: readonly RunEventKind[] = [
  "started",
  "findings",
  "repair_requested",
  "repair_started",
  "repair_failed",
  "pr_opened",
  "tickets_filed",
  "ticket_outcomes",
  "repair_summary",
  "completed",
  "failed",
];

export type RunTimeline = {
  agent: string;
  title: string;
  runId: string;
  events: RunEvent[];
};

export type TimelineRef = { channel: string; ts: string };

/** Current time in epoch seconds, the unit every RunEvent `at` uses. */
export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
