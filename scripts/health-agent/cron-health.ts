import { stableFingerprint, type HealthFinding, type JsonValue } from "./contracts";

export const CRON_HEALTH_LOOKBACK_HOURS = 48;
export const CRON_SILENCE_MARKER = "cron_http_no_response:";

export interface CronHttpLogRow {
  request_id: number;
  job_name: string;
  status_code: number | null;
  timed_out: boolean;
  error_msg: string | null;
  created: string | null;
  logged_at: string;
}

function finding(
  signal: "non-2xx" | "timeout" | "silence",
  jobName: string,
  severity: "high" | "medium",
  rows: CronHttpLogRow[],
): HealthFinding {
  const evidence: Record<string, JsonValue> = {
    jobName,
    lookbackHours: CRON_HEALTH_LOOKBACK_HOURS,
    rowCount: rows.length,
    requestIds: rows.map((row) => row.request_id),
  };
  return {
    evidence,
    fingerprint: stableFingerprint("cron", signal, jobName),
    mergePolicy: "human",
    severity,
    source: "cron",
    title:
      signal === "non-2xx"
        ? `Cron HTTP job returned non-2xx: ${jobName}`
        : signal === "timeout"
          ? `Cron HTTP job timed out in pg_net: ${jobName}`
          : `Cron HTTP job received no response: ${jobName}`,
  };
}

export function evaluateCronHealth(rows: readonly CronHttpLogRow[]): HealthFinding[] {
  const grouped = new Map<string, CronHttpLogRow[]>();
  const add = (signal: string, row: CronHttpLogRow) => {
    const key = `${signal}\0${row.job_name}`;
    const group = grouped.get(key) ?? [];
    group.push(row);
    grouped.set(key, group);
  };
  for (const row of rows) {
    if (row.status_code !== null && (row.status_code < 200 || row.status_code > 299)) {
      add("non-2xx", row);
    }
    if (row.timed_out) add("timeout", row);
    if (
      row.status_code === null &&
      row.error_msg?.startsWith(CRON_SILENCE_MARKER)
    ) {
      add("silence", row);
    }
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, group]) => {
      const [signal, jobName] = key.split("\0");
      return finding(
        signal as "non-2xx" | "timeout" | "silence",
        jobName,
        signal === "timeout" ? "medium" : "high",
        group,
      );
    });
}
