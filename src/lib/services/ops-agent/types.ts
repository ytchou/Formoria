import type { Json } from "@/lib/supabase/database.types";

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export type OpsRequestStatus =
  | "received"
  | "running"
  | "answered"
  | "awaiting_confirm"
  | "executed"
  | "cancelled"
  | "expired"
  | "refused"
  | "failed";

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

export type OpsRequestRow = {
  id: string;
  slackEventId: string | null;
  slackUserId: string;
  operatorEmail: string | null;
  channelId: string;
  threadTs: string;
  cardTs: string | null;
  text: string;
  status: OpsRequestStatus;
  result: Json | null;
  proposal: Json | null;
  toolCalls: Json;
  modelCalls: number;
  costUsd: number;
  completedAt: string | null;
  correlationId: string | null;
  sessionUrl: string | null;
  dispatchedAt: string | null;
  dispatchClaimedAt: string | null;
  dispatchRunId: string | null;
  dispatchCompletedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
};

// ---------------------------------------------------------------------------
// E2E dispatch (DEV-1854)
// ---------------------------------------------------------------------------

/** Every valid DispatchOutcome, for runtime validation. */
export const DISPATCH_OUTCOMES = ["green", "red", "errored", "crashed"] as const;
/** Final state of a dispatched e2e run, merged into `result.e2eOutcome`. */
export type DispatchOutcome = (typeof DISPATCH_OUTCOMES)[number];

/** An ops-bot e2e dispatch, projected from its `ops_agent_requests` row. */
export type OpsDispatch = {
  id: string;
  channelId: string;
  threadTs: string;
  /** Slack user who asked for the run (`slack_user_id`). */
  requesterId: string;
  runId: string | null;
  claimedAt: string | null;
};

// ---------------------------------------------------------------------------
// Operator map
// ---------------------------------------------------------------------------

/** Map<slackUserId, operatorEmail> */
export type OperatorMap = Map<string, string>;
