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
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
};

// ---------------------------------------------------------------------------
// Operator map
// ---------------------------------------------------------------------------

/** Map<slackUserId, operatorEmail> */
export type OperatorMap = Map<string, string>;
