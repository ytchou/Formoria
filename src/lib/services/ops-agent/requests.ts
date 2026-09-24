import { auditedCall } from "@/lib/audit";
import { createServiceClient } from "@/lib/supabase/service";
import type { Database } from "@/lib/supabase/database.types";
import type { OpsRequestRow, OpsRequestStatus } from "./types";

type DbRow = Database["public"]["Tables"]["ops_agent_requests"]["Row"];
type SupabaseClient = ReturnType<typeof createServiceClient>;

const THREAD_HISTORY_LIMIT = 10;

function toCamel(row: DbRow): OpsRequestRow {
  return {
    id: row.id,
    slackEventId: row.slack_event_id,
    slackUserId: row.slack_user_id,
    operatorEmail: row.operator_email,
    channelId: row.channel_id,
    threadTs: row.thread_ts,
    cardTs: row.card_ts,
    text: row.text,
    status: row.status as OpsRequestStatus,
    result: row.result,
    proposal: row.proposal,
    toolCalls: row.tool_calls,
    modelCalls: row.model_calls,
    costUsd: row.cost_usd,
    completedAt: row.completed_at,
    correlationId: row.correlation_id,
    sessionUrl: row.session_url,
    dispatchedAt: row.dispatched_at,
    dispatchClaimedAt: row.dispatch_claimed_at,
    dispatchRunId: row.dispatch_run_id,
    dispatchCompletedAt: row.dispatch_completed_at,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type CreateRequestInput = {
  slackEventId: string | null;
  slackUserId: string;
  operatorEmail: string | null;
  channelId: string;
  threadTs: string;
  text: string;
  status: "received" | "refused";
};

export type CreateRequestResult =
  | { duplicate: true }
  | { duplicate: false; row: OpsRequestRow };

export async function createRequest(
  input: CreateRequestInput,
  client?: SupabaseClient,
): Promise<CreateRequestResult> {
  return auditedCall(
    { provider: "ops-agent", operation: "createRequest", kind: "service" },
    async () => {
      const supabase = client ?? createServiceClient();

      const { data, error } = await supabase
        .from("ops_agent_requests")
        .insert({
          slack_event_id: input.slackEventId,
          slack_user_id: input.slackUserId,
          operator_email: input.operatorEmail,
          channel_id: input.channelId,
          thread_ts: input.threadTs,
          text: input.text,
          status: input.status,
        })
        .select()
        .single();

      if (error) {
        if (error.code === "23505") return { duplicate: true };
        throw new Error(`createRequest failed: ${error.message}`);
      }

      return { duplicate: false, row: toCamel(data) };
    },
  );
}

async function countToday(
  channelId: string,
  client?: SupabaseClient,
): Promise<number> {
  const supabase = client ?? createServiceClient();

  const now = new Date();
  const taipeiOffset = 8 * 60;
  const taipeiMs =
    now.getTime() + (taipeiOffset + now.getTimezoneOffset()) * 60_000;
  const taipeiDate = new Date(taipeiMs);
  const year = taipeiDate.getFullYear();
  const month = String(taipeiDate.getMonth() + 1).padStart(2, "0");
  const day = String(taipeiDate.getDate()).padStart(2, "0");

  const dayStartUtc = `${year}-${month}-${day}T00:00:00+08:00`;
  const dayEndUtc = `${year}-${month}-${day}T23:59:59.999+08:00`;

  const { count, error } = await supabase
    .from("ops_agent_requests")
    .select("id", { count: "exact", head: true } as unknown as undefined)
    .eq("channel_id", channelId)
    .neq("status", "refused")
    .gte("created_at", dayStartUtc)
    .lt("created_at", dayEndUtc);

  if (error) throw new Error(`countToday failed: ${error.message}`);
  return count ?? 0;
}

export type AdmitResult =
  | { ok: true; row: OpsRequestRow }
  | { ok: true; duplicate: true }
  | { ok: false; reason: "daily_cap" };

export async function admitRequest(
  input: CreateRequestInput,
  cap: number,
  client?: SupabaseClient,
): Promise<AdmitResult> {
  return auditedCall(
    { provider: "ops-agent", operation: "admitRequest", kind: "service" },
    async () => {
      const supabase = client ?? createServiceClient();

      const created = await createRequest(input, supabase);
      if (created.duplicate) {
        return { ok: true, duplicate: true as const };
      }

      const row = created.row;
      const todayCount = await countToday(input.channelId, supabase);

      if (todayCount > cap) {
        await transitionRequest(row.id, ["received"], "refused", {
          result: { reason: "daily_cap" },
        }, supabase);
        return { ok: false, reason: "daily_cap" };
      }

      return { ok: true, row };
    },
  );
}

export async function isActiveThread(
  channelId: string,
  threadTs: string,
  client?: SupabaseClient,
): Promise<boolean> {
  return auditedCall(
    { provider: "ops-agent", operation: "isActiveThread", kind: "service" },
    async () => {
      const supabase = client ?? createServiceClient();

      try {
        const { count, error } = await supabase
          .from("ops_agent_requests")
          .select("id", { count: "exact", head: true } as unknown as undefined)
          .eq("channel_id", channelId)
          .eq("thread_ts", threadTs)
          .neq("status", "refused")
          .is("completed_at", null);

        if (error) {
          console.warn(`[ops-agent] isActiveThread query failed: ${error.message}`);
          return false;
        }

        return (count ?? 0) > 0;
      } catch {
        return false;
      }
    },
  );
}

export async function completeThread(
  channelId: string,
  threadTs: string,
  client?: SupabaseClient,
): Promise<number> {
  return auditedCall(
    { provider: "ops-agent", operation: "completeThread", kind: "service" },
    async () => {
      const supabase = client ?? createServiceClient();

      const { data, error } = await supabase
        .from("ops_agent_requests")
        .update({ completed_at: new Date().toISOString() })
        .eq("channel_id", channelId)
        .eq("thread_ts", threadTs)
        .is("completed_at", null)
        .select("id");

      if (error) throw new Error(`completeThread failed: ${error.message}`);
      return data?.length ?? 0;
    },
  );
}

export async function reactivateThread(
  channelId: string,
  threadTs: string,
  client?: SupabaseClient,
): Promise<number> {
  return auditedCall(
    { provider: "ops-agent", operation: "reactivateThread", kind: "service" },
    async () => {
      const supabase = client ?? createServiceClient();

      const { data, error } = await supabase
        .from("ops_agent_requests")
        .update({ completed_at: null })
        .eq("channel_id", channelId)
        .eq("thread_ts", threadTs)
        .not("completed_at", "is", null)
        .select("id");

      if (error) throw new Error(`reactivateThread failed: ${error.message}`);
      return data?.length ?? 0;
    },
  );
}

export async function getThreadHistory(
  channelId: string,
  threadTs: string,
  excludeId: string,
  limit: number = THREAD_HISTORY_LIMIT,
  client?: SupabaseClient,
): Promise<OpsRequestRow[]> {
  return auditedCall(
    { provider: "ops-agent", operation: "getThreadHistory", kind: "service" },
    async () => {
      const supabase = client ?? createServiceClient();

      const { data, error } = await supabase
        .from("ops_agent_requests")
        .select("id, slack_event_id, slack_user_id, operator_email, channel_id, thread_ts, card_ts, text, status, result, proposal, tool_calls, model_calls, cost_usd, completed_at, correlation_id, session_url, dispatched_at, dispatch_claimed_at, dispatch_run_id, dispatch_completed_at, expires_at, created_at, updated_at")
        .eq("channel_id", channelId)
        .eq("thread_ts", threadTs)
        .neq("id", excludeId)
        .not("status", "in", '("received","running")')
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) throw new Error(`getThreadHistory failed: ${error.message}`);
      return (data ?? []).reverse().map(toCamel);
    },
  );
}

export async function getRequest(
  id: string,
  client?: SupabaseClient,
): Promise<OpsRequestRow | null> {
  return auditedCall(
    { provider: "ops-agent", operation: "getRequest", kind: "service" },
    async () => {
      const supabase = client ?? createServiceClient();

      const { data, error } = await supabase
        .from("ops_agent_requests")
        .select()
        .eq("id", id)
        .maybeSingle();

      if (error) throw new Error(`getRequest failed: ${error.message}`);
      return data ? toCamel(data) : null;
    },
  );
}

export async function transitionRequest(
  id: string,
  from: OpsRequestStatus[],
  to: OpsRequestStatus,
  patch?: {
    result?: unknown;
    proposal?: unknown;
    expiresAt?: string | null;
    cardTs?: string | null;
  },
  client?: SupabaseClient,
): Promise<OpsRequestRow> {
  return auditedCall(
    { provider: "ops-agent", operation: "transitionRequest", kind: "service" },
    async () => {
      const supabase = client ?? createServiceClient();

      const updatePayload: Record<string, unknown> = { status: to };
      if (patch?.result !== undefined) updatePayload.result = patch.result;
      if (patch?.proposal !== undefined)
        updatePayload.proposal = patch.proposal;
      if (patch?.expiresAt !== undefined)
        updatePayload.expires_at = patch.expiresAt;
      if (patch?.cardTs !== undefined) updatePayload.card_ts = patch.cardTs;

      const { data, error } = await supabase
        .from("ops_agent_requests")
        .update(updatePayload)
        .eq("id", id)
        .in("status", from)
        .select()
        .single();

      if (error) {
        throw new Error(
          `Illegal status transition for ${id}: ${from.join("|")} -> ${to} (${error.message})`,
        );
      }

      return toCamel(data);
    },
  );
}

export async function expireStale(client?: SupabaseClient): Promise<void> {
  return auditedCall(
    { provider: "ops-agent", operation: "expireStale", kind: "service" },
    async () => {
      const supabase = client ?? createServiceClient();
      const now = new Date().toISOString();
      const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();

      const { error: failError } = await supabase
        .from("ops_agent_requests")
        .update({ status: "failed" })
        .eq("status", "running")
        .lte("updated_at", fiveMinAgo);

      if (failError) {
        throw new Error(
          `expireStale (running->failed) failed: ${failError.message}`,
        );
      }

      const { error: expireError } = await supabase
        .from("ops_agent_requests")
        .update({ status: "expired" })
        .eq("status", "awaiting_confirm")
        .lte("expires_at", now);

      if (expireError) {
        throw new Error(
          `expireStale (awaiting_confirm->expired) failed: ${expireError.message}`,
        );
      }
    },
  );
}
