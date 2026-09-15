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

/**
 * Legal status transitions.
 *
 * received        -> running, refused
 * running         -> answered, awaiting_confirm, refused, failed
 * awaiting_confirm -> executed, cancelled, expired, running (re-enter)
 */
export const LEGAL_TRANSITIONS: Record<OpsRequestStatus, readonly OpsRequestStatus[]> = {
  received: ["running", "refused"],
  running: ["answered", "awaiting_confirm", "refused", "failed"],
  awaiting_confirm: ["executed", "cancelled", "expired", "running"],
  answered: [],
  executed: [],
  cancelled: [],
  expired: [],
  refused: [],
  failed: [],
};

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
  correlationId: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
};

// ---------------------------------------------------------------------------
// Operator map
// ---------------------------------------------------------------------------

/** Map<slackUserId, operatorEmail> */
export type OperatorMap = Map<string, string>;
