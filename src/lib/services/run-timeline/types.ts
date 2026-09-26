export const RUN_TIMELINE_EVENT_TYPE = "formoria_run_timeline";

export type RunTicket = {
  id: string;
  url: string;
  title: string;
  fingerprints?: string[];
};

export type RunEvent =
  | { kind: "started"; at: number }
  | {
      kind: "findings";
      at: number;
      // health agent
      total?: number;
      repairable?: number;
      reportOnly?: number;
      /** Detectors that could not run; their sources are missing from `total`. */
      failedDetectors?: number;
      // e2e agent
      passed?: number;
      failed?: number;
      flaky?: number;
      skipped?: number;
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
