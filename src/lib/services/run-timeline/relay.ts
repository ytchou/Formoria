import { z } from "zod";
import {
  recordTickets,
  type HealthLedgerClient,
} from "@/lib/services/health-agent/lifecycle";
import { createServiceClient } from "@/lib/supabase/service";
import { appendRunEvent } from "./append";
import type { RunEvent, TimelineRef } from "./types";

/**
 * Relay for the ops routine (a Claude Code cloud session with no DB access).
 * It appends one routine-owned timeline event to the run's Slack parent and
 * writes Linear ticket identifiers back to `health_fix_queue`, so a finding
 * the routine ticketed is not re-sent the next night.
 */

const httpsUrl = z.string().max(2048).regex(/^https:\/\/\S+$/);
const title = z.string().min(1).max(300);
const fingerprints = z.array(z.string().min(1).max(200)).max(100);
const ticketId = z.string().regex(/^[A-Z][A-Z0-9]*-\d+$/);
// Server-set when omitted; epoch seconds.
const at = z.number().int().nonnegative().optional();

// Only the kinds the routine owns. started/findings/repair_* belong to the
// agents and the ops-agent, never to this relay.
const routineEventSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("pr_opened"),
    at,
    number: z.number().int().positive(),
    url: httpsUrl,
    title,
    ticketId: ticketId.optional(),
    // Relay-only: used for the write-back, stripped before appending.
    fingerprints: fingerprints.optional(),
  }),
  z.object({
    kind: z.literal("tickets_filed"),
    at,
    tickets: z
      .array(
        z.object({
          id: ticketId,
          url: httpsUrl,
          title,
          fingerprints: fingerprints.optional(),
        }),
      )
      .min(1)
      .max(50),
  }),
  z.object({ kind: z.literal("completed"), at }),
  z.object({
    kind: z.literal("failed"),
    at,
    outcome: z.string().min(1).max(100),
    reason: z.string().max(1000).optional(),
  }),
]);

const routineTimelineRequestSchema = z.object({
  channel: z.string().regex(/^[A-Z0-9]+$/),
  ts: z.string().regex(/^\d+\.\d+$/),
  event: routineEventSchema,
});

type RoutineEvent = z.infer<typeof routineEventSchema>;
type TicketLink = { fingerprint: string; identifier: string };

export type RoutineTimelineDeps = {
  appendRunEvent: (ref: TimelineRef, event: RunEvent) => Promise<boolean>;
  recordTickets: (tickets: TicketLink[]) => Promise<number>;
  now: () => number;
};

const defaultDeps: RoutineTimelineDeps = {
  appendRunEvent: (ref, event) => appendRunEvent(ref, event),
  // Same service-role client the health-agent server passes to its ledger calls.
  recordTickets: (tickets) =>
    recordTickets(createServiceClient() as unknown as HealthLedgerClient, tickets),
  now: () => Math.floor(Date.now() / 1000),
};

export type RoutineTimelineResult =
  | { ok: false; error: string }
  | {
      ok: true;
      appended: boolean;
      recorded: number;
      recordError?: string;
    };

function toRunEvent(event: RoutineEvent, at: number): RunEvent {
  switch (event.kind) {
    case "pr_opened":
      return {
        kind: "pr_opened",
        at,
        number: event.number,
        url: event.url,
        title: event.title,
        ...(event.ticketId ? { ticketId: event.ticketId } : {}),
      };
    case "tickets_filed":
      return { kind: "tickets_filed", at, tickets: event.tickets };
    case "completed":
      return { kind: "completed", at };
    case "failed":
      return {
        kind: "failed",
        at,
        outcome: event.outcome,
        ...(event.reason ? { reason: event.reason } : {}),
      };
  }
}

function ticketLinks(event: RoutineEvent): TicketLink[] {
  if (event.kind === "tickets_filed") {
    return event.tickets.flatMap((ticket) =>
      (ticket.fingerprints ?? []).map((fingerprint) => ({
        fingerprint,
        identifier: ticket.id,
      })),
    );
  }
  if (event.kind === "pr_opened" && event.ticketId) {
    const identifier = event.ticketId;
    return (event.fingerprints ?? []).map((fingerprint) => ({ fingerprint, identifier }));
  }
  return [];
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

/**
 * Validates a routine relay body, appends the event, and records ticket
 * identifiers. A write-back failure never fails the append: it is logged and
 * reported as `recorded: 0` with `recordError`.
 */
export async function applyRoutineTimelineEvent(
  body: unknown,
  deps: RoutineTimelineDeps = defaultDeps,
): Promise<RoutineTimelineResult> {
  const parsed = routineTimelineRequestSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.join(".") || "body";
    return { ok: false, error: `${path}: ${issue?.message ?? "invalid"}` };
  }

  const { channel, ts, event } = parsed.data;
  const appended = await deps.appendRunEvent(
    { channel, ts },
    toRunEvent(event, event.at ?? deps.now()),
  );

  const links = ticketLinks(event);
  if (links.length === 0) return { ok: true, appended, recorded: 0 };

  try {
    const recorded = await deps.recordTickets(links);
    return { ok: true, appended, recorded };
  } catch (error) {
    const recordError = errorMessage(error);
    console.error(`[run-timeline] recordTickets failed for ${channel}/${ts}: ${recordError}`);
    return { ok: true, appended, recorded: 0, recordError };
  }
}
