import { auditedCall } from "@/lib/audit";
import { createServiceClient } from "@/lib/supabase/service";
import type { Database, Json } from "@/lib/supabase/database.types";
import type { DispatchOutcome, OpsDispatch } from "./types";

type DbRow = Database["public"]["Tables"]["ops_agent_requests"]["Row"];
type SupabaseClient = ReturnType<typeof createServiceClient>;

/** The row columns the dispatch helpers read. */
export type DispatchRow = Pick<
  DbRow,
  | "id"
  | "channel_id"
  | "thread_ts"
  | "slack_user_id"
  | "dispatched_at"
  | "dispatch_claimed_at"
  | "dispatch_run_id"
  | "dispatch_completed_at"
>;

const DISPATCH_COLUMNS =
  "id, channel_id, thread_ts, slack_user_id, dispatched_at, dispatch_claimed_at, dispatch_run_id, dispatch_completed_at";

/**
 * How long a recorded dispatch waits for the staging agent to claim it.
 * Ceiling: 10 min covers a Railway Run-now cold start plus install; raise it
 * if agent boot regularly takes longer, or unclaimed runs will be dropped.
 */
export const PENDING_LEASE_MS = 10 * 60_000;

/**
 * How long a claimed dispatch counts as running before it is presumed dead.
 * Ceiling: 40 min is above the e2e runner timeout (~20 min run plus repair);
 * raise it together with the runner timeout.
 */
export const RUNNING_LEASE_MS = 40 * 60_000;

/**
 * Delay before the ops bot checks whether a dispatch was ever claimed.
 * Ceiling: must stay below PENDING_LEASE_MS so the stale check fires while the
 * dispatch can still be marked stale.
 */
export const STALE_CHECK_MS = 5 * 60_000;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function toDispatch(row: DispatchRow): OpsDispatch {
  return {
    id: row.id,
    channelId: row.channel_id,
    threadTs: row.thread_ts,
    requesterId: row.slack_user_id,
    runId: row.dispatch_run_id,
    claimedAt: row.dispatch_claimed_at,
  };
}

/**
 * True while a dispatch holds its lease: pending (unclaimed) for less than
 * PENDING_LEASE_MS, or claimed and not completed for less than RUNNING_LEASE_MS.
 */
export function isInFlight(row: DispatchRow, now: Date): boolean {
  if (!row.dispatched_at || row.dispatch_completed_at) return false;
  const nowMs = now.getTime();
  if (row.dispatch_claimed_at) {
    return nowMs - Date.parse(row.dispatch_claimed_at) < RUNNING_LEASE_MS;
  }
  return nowMs - Date.parse(row.dispatched_at) < PENDING_LEASE_MS;
}

// Re-exported so existing importers keep working; the pure module is the owner.
export { threadLink } from "@/lib/adapters/slack/thread-link";

function isJsonObject(value: Json | null): value is { [key: string]: Json | undefined } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// DB operations
// ---------------------------------------------------------------------------

export async function recordDispatch(
  requestId: string,
  client?: SupabaseClient,
): Promise<void> {
  return auditedCall(
    { provider: "ops-agent", operation: "recordDispatch", kind: "service" },
    async () => {
      const supabase = client ?? createServiceClient();
      const { error } = await supabase
        .from("ops_agent_requests")
        .update({ dispatched_at: new Date().toISOString() })
        .eq("id", requestId);

      if (error) throw new Error(`recordDispatch failed: ${error.message}`);
    },
  );
}

/**
 * Undo recordDispatch when the Run-now trigger fails. Conditional on
 * `dispatch_claimed_at IS NULL`, so a row an agent already claimed is never
 * un-dispatched.
 */
export async function clearDispatch(
  requestId: string,
  client?: SupabaseClient,
): Promise<void> {
  return auditedCall(
    { provider: "ops-agent", operation: "clearDispatch", kind: "service" },
    async () => {
      const supabase = client ?? createServiceClient();
      const { error } = await supabase
        .from("ops_agent_requests")
        .update({ dispatched_at: null })
        .eq("id", requestId)
        .is("dispatch_claimed_at", null);

      if (error) throw new Error(`clearDispatch failed: ${error.message}`);
    },
  );
}

/** Newest dispatch that still holds its lease, or null. */
export async function findInFlightDispatch(
  client?: SupabaseClient,
): Promise<OpsDispatch | null> {
  return auditedCall(
    { provider: "ops-agent", operation: "findInFlightDispatch", kind: "service" },
    async () => {
      const supabase = client ?? createServiceClient();
      const now = new Date();
      const since = new Date(now.getTime() - RUNNING_LEASE_MS).toISOString();

      // Coarse time window in SQL; the exact lease predicate runs in TS.
      const { data, error } = await supabase
        .from("ops_agent_requests")
        .select(DISPATCH_COLUMNS)
        .not("dispatched_at", "is", null)
        .is("dispatch_completed_at", null)
        .gte("dispatched_at", since)
        .order("dispatched_at", { ascending: false })
        .limit(10);

      if (error) throw new Error(`findInFlightDispatch failed: ${error.message}`);

      const row = (data ?? []).find((r) => isInFlight(r, now));
      return row ? toDispatch(row) : null;
    },
  );
}

/**
 * Atomically claim the oldest pending dispatch for `runId`. Each update is
 * conditional on `dispatch_claimed_at IS NULL` and `dispatch_completed_at IS
 * NULL`, so two concurrent claims cannot win the same row and a dispatch
 * marked stale in between cannot be claimed. Returns null when nothing is pending.
 */
export async function claimDispatch(
  runId: string,
  client?: SupabaseClient,
): Promise<OpsDispatch | null> {
  return auditedCall(
    { provider: "ops-agent", operation: "claimDispatch", kind: "service" },
    async () => {
      const supabase = client ?? createServiceClient();
      const since = new Date(Date.now() - PENDING_LEASE_MS).toISOString();

      const { data: candidates, error: selectError } = await supabase
        .from("ops_agent_requests")
        .select("id")
        .gte("dispatched_at", since)
        .is("dispatch_claimed_at", null)
        .is("dispatch_completed_at", null)
        .order("dispatched_at", { ascending: true })
        .limit(3);

      if (selectError) {
        throw new Error(`claimDispatch select failed: ${selectError.message}`);
      }

      for (const candidate of candidates ?? []) {
        const { data: won, error: updateError } = await supabase
          .from("ops_agent_requests")
          .update({
            dispatch_claimed_at: new Date().toISOString(),
            dispatch_run_id: runId,
          })
          .eq("id", candidate.id)
          .is("dispatch_claimed_at", null)
          .is("dispatch_completed_at", null)
          .select(DISPATCH_COLUMNS);

        if (updateError) {
          throw new Error(`claimDispatch update failed: ${updateError.message}`);
        }

        const row = won?.at(0);
        if (row) return toDispatch(row);
      }

      return null;
    },
  );
}

/**
 * Mark a claimed dispatch complete and merge `{ e2eOutcome }` into `result`.
 * Matches on `dispatch_run_id` so one run cannot complete another run's
 * dispatch, and on `dispatch_completed_at IS NULL` so a repeat complete is a
 * no-op. Returns false when no row matched.
 */
export async function completeDispatch(
  id: string,
  runId: string,
  outcome: DispatchOutcome,
  client?: SupabaseClient,
): Promise<boolean> {
  return auditedCall(
    { provider: "ops-agent", operation: "completeDispatch", kind: "service" },
    async () => {
      const supabase = client ?? createServiceClient();

      const { data: current, error: readError } = await supabase
        .from("ops_agent_requests")
        .select("result")
        .eq("id", id)
        .eq("dispatch_run_id", runId)
        .is("dispatch_completed_at", null)
        .maybeSingle();

      if (readError) {
        throw new Error(`completeDispatch read failed: ${readError.message}`);
      }
      if (!current) return false;

      // Read-then-write merge; safe because only the owning run (matched by
      // dispatch_run_id) writes result here. Move to a jsonb RPC if other
      // writers start touching result concurrently.
      const base = isJsonObject(current.result) ? current.result : {};
      const { data, error } = await supabase
        .from("ops_agent_requests")
        .update({
          dispatch_completed_at: new Date().toISOString(),
          result: { ...base, e2eOutcome: outcome },
        })
        .eq("id", id)
        .eq("dispatch_run_id", runId)
        .is("dispatch_completed_at", null)
        .select("id");

      if (error) throw new Error(`completeDispatch failed: ${error.message}`);
      return (data?.length ?? 0) > 0;
    },
  );
}

/**
 * If the dispatch is still unclaimed, close it and return true; otherwise
 * (claimed or already completed) return false.
 */
export async function markDispatchStale(
  id: string,
  client?: SupabaseClient,
): Promise<boolean> {
  return auditedCall(
    { provider: "ops-agent", operation: "markDispatchStale", kind: "service" },
    async () => {
      const supabase = client ?? createServiceClient();
      const { data, error } = await supabase
        .from("ops_agent_requests")
        .update({ dispatch_completed_at: new Date().toISOString() })
        .eq("id", id)
        .is("dispatch_claimed_at", null)
        .is("dispatch_completed_at", null)
        .select("id");

      if (error) throw new Error(`markDispatchStale failed: ${error.message}`);
      return (data?.length ?? 0) > 0;
    },
  );
}
