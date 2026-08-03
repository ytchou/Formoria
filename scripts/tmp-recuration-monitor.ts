/**
 * TEMPORARY — recuration-2026-08-03 watch. Delete when the run is done.
 *
 * Polls the 34 `recuration-2026-08-03:*` jobs. Emits one stdout line per state
 * change. If OpenAI quota errors appear, cancels every pending/running job in
 * the set via `cancel_curation_job` (the same RPC the admin cancel button uses)
 * and exits.
 *
 * Run: pnpm exec tsx --env-file=.env.local scripts/tmp-recuration-monitor.ts
 */
import { createClient } from "@supabase/supabase-js";

const KEY_PREFIX = "recuration-2026-08-03:";
const POLL_MS = 60_000;
const STALL_MS = 8 * 60_000;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const QUOTA = /429|quota|insufficient_quota|billing|credit/i;

function say(line: string) {
  process.stdout.write(`${line}\n`);
}

async function jobs() {
  const { data, error } = await supabase
    .from("curation_jobs")
    .select(
      "id, dedupe_key, status, succeeded_count, failed_count, skipped_count, heartbeat_at, job_error",
    )
    .like("dedupe_key", `${KEY_PREFIX}%`);
  if (error) throw error;
  return data ?? [];
}

async function quotaHits(jobIds: string[]) {
  if (jobIds.length === 0) return 0;
  const { data, error } = await supabase
    .from("curation_job_targets")
    .select("error")
    .in("job_id", jobIds)
    .not("error", "is", null);
  if (error) throw error;
  return (data ?? []).filter((row) => QUOTA.test(row.error ?? "")).length;
}

async function stop(reason: string, rows: { id: string; status: string }[]) {
  const open = rows.filter((r) => r.status === "pending" || r.status === "running");
  let cancelled = 0;
  for (const job of open) {
    const { error } = await supabase.rpc("cancel_curation_job", {
      p_job_id: job.id,
      p_reason: reason,
    });
    if (!error) cancelled += 1;
  }
  say(`STOPPED: ${reason} — cancelled ${cancelled}/${open.length} open jobs`);
}

async function main() {
  let lastSignature = "";
  let lastProgressAt = Date.now();

  for (;;) {
    let rows;
    try {
      rows = await jobs();
    } catch (err) {
      say(`POLL-ERROR: ${err instanceof Error ? err.message : String(err)}`);
      await new Promise((r) => setTimeout(r, POLL_MS));
      continue;
    }

    const pending = rows.filter((r) => r.status === "pending").length;
    const running = rows.filter((r) => r.status === "running").length;
    const completed = rows.filter((r) => r.status === "completed").length;
    const cancelled = rows.filter((r) => r.status === "cancelled").length;
    const ok = rows.reduce((n, r) => n + (r.succeeded_count ?? 0), 0);
    const failed = rows.reduce((n, r) => n + (r.failed_count ?? 0), 0);

    const hits = await quotaHits(rows.map((r) => r.id)).catch(() => 0);
    if (hits > 0) {
      say(`QUOTA FAILURE: ${hits} targets hit an OpenAI quota/429 error — stopping`);
      await stop("OpenAI quota exhausted — auto-stopped by monitor", rows);
      return;
    }

    const jobErr = rows.find((r) => r.job_error && QUOTA.test(r.job_error));
    if (jobErr) {
      say(`QUOTA FAILURE (job-level) on ${jobErr.dedupe_key} — stopping`);
      await stop("OpenAI quota exhausted — auto-stopped by monitor", rows);
      return;
    }

    const signature = `${pending}/${running}/${completed}/${cancelled}/${ok}/${failed}`;
    if (signature !== lastSignature) {
      say(
        `progress: ${completed}/34 batches done, ${running} running, ${pending} pending — ${ok} brands ok, ${failed} failed`,
      );
      lastSignature = signature;
      lastProgressAt = Date.now();
    }

    if (pending === 0 && running === 0) {
      say(`DONE: ${completed} completed, ${cancelled} cancelled, ${ok} brands ok, ${failed} failed`);
      return;
    }

    if (running === 0 && pending > 0 && Date.now() - lastProgressAt > STALL_MS) {
      say(
        `STALLED: ${pending} batches pending, nothing running for 8+ min — drain died, needs a Dispatch click`,
      );
      lastProgressAt = Date.now();
    }

    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main().catch((err) => {
  say(`MONITOR-CRASH: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
