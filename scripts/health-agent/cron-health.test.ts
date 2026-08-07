import { describe, expect, it } from "vitest";

import {
  CRON_HEALTH_LOOKBACK_HOURS,
  EXPECTED_CRON_JOBS,
  evaluateCronHealth,
  type CronHttpLogRow,
} from "./cron-health";
import { collectCronHealthArtifact } from "./workflow-runtime";

const runAt = "2026-08-07T04:00:00.000Z";
const now = new Date(runAt);

const HOURLY = "claim-proof-cleanup-hourly";
const WEEKLY = "sync-mit-registry-weekly";

function hoursBefore(hours: number): string {
  return new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();
}

function row(
  overrides: Partial<CronHttpLogRow> & { job_name: string },
): CronHttpLogRow {
  return {
    created: runAt,
    error_msg: null,
    logged_at: runAt,
    request_id: 1,
    status_code: 200,
    timed_out: false,
    ...overrides,
  };
}

/**
 * Every expected job succeeding well inside its staleness budget. Derived from
 * EXPECTED_CRON_JOBS rather than listed, so adding a job to that list does not
 * turn every test in this file red for the wrong reason. One hour is inside the
 * tightest budget (3h) and therefore inside all of them.
 */
function healthyRows(): CronHttpLogRow[] {
  return EXPECTED_CRON_JOBS.map((job, index) =>
    row({
      job_name: job.jobName,
      request_id: index + 1,
      status_code: index === 0 ? 204 : 200,
      created: hoursBefore(1),
    }),
  );
}

function fingerprints(findings: readonly { fingerprint: string }[]): string[] {
  return findings.map((finding) => finding.fingerprint).sort();
}

function dependencyWithRows(rows: unknown[]) {
  const contents = new Map<string, string>();
  return {
    env: {
      HEALTH_AGENT_READER_TOKEN: "reader-token",
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    },
    fetchImplementation: async () =>
      new Response(JSON.stringify(rows), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    files: {
      read: async (path: string) => contents.get(path) ?? "",
      write: async (path: string, value: string) => {
        contents.set(path, value);
      },
    },
  };
}

describe("evaluateCronHealth", () => {
  it("reads a window wider than the slowest job's staleness budget", () => {
    const widest = Math.max(
      ...EXPECTED_CRON_JOBS.map((job) => job.maxAgeHours),
    );
    expect(CRON_HEALTH_LOOKBACK_HOURS).toBeGreaterThan(widest);
  });

  it("returns no findings when every expected job succeeded recently", () => {
    expect(evaluateCronHealth(healthyRows(), now)).toEqual([]);
  });

  it("flags a non-2xx response as a failure", () => {
    const rows = [
      ...healthyRows(),
      row({ job_name: HOURLY, request_id: 9, status_code: 401 }),
    ];
    const findings = evaluateCronHealth(rows, now);
    expect(fingerprints(findings)).toEqual([`cron:failed:${HOURLY}`]);
    expect(findings[0]).toMatchObject({
      severity: "high",
      source: "cron",
    });
    expect(findings[0]?.evidence).toMatchObject({
      failureCount: 1,
      jobName: HOURLY,
      statusCodes: [401],
    });
  });

  it("flags a pg_net transport failure — status_code null, not timed out — as a failure", () => {
    // Regression guard for F3: this row matched none of the old non-2xx /
    // timeout / silence-marker branches, so a DNS failure read as healthy.
    const rows = [
      ...healthyRows(),
      row({
        job_name: WEEKLY,
        request_id: 9,
        status_code: null,
        timed_out: false,
        error_msg: "Could not resolve host: formoria.com",
      }),
    ];
    const findings = evaluateCronHealth(rows, now);
    expect(fingerprints(findings)).toEqual([`cron:failed:${WEEKLY}`]);
    expect(findings[0]?.evidence).toMatchObject({
      sampleErrorMsg: "Could not resolve host: formoria.com",
      statusCodes: [],
      transportFailureCount: 1,
    });
  });

  it("flags a timed-out dispatch as a failure even when the status code is 2xx", () => {
    const rows = [
      ...healthyRows(),
      row({
        job_name: HOURLY,
        request_id: 9,
        status_code: 200,
        timed_out: true,
      }),
    ];
    const findings = evaluateCronHealth(rows, now);
    expect(fingerprints(findings)).toEqual([`cron:failed:${HOURLY}`]);
    expect(findings[0]?.evidence).toMatchObject({ timedOutCount: 1 });
  });

  it("flags a job whose newest success is older than its maxAgeHours as stale", () => {
    const rows = [
      ...healthyRows().filter((logged) => logged.job_name !== HOURLY),
      row({
        job_name: HOURLY,
        request_id: 1,
        status_code: 200,
        created: hoursBefore(5),
      }),
    ];
    const findings = evaluateCronHealth(rows, now);
    expect(fingerprints(findings)).toEqual([`cron:stale:${HOURLY}`]);
    expect(findings[0]).toMatchObject({ severity: "high", source: "cron" });
    expect(findings[0]?.evidence).toMatchObject({
      lastSuccessAt: hoursBefore(5),
      maxAgeHours: 3,
      successCount: 1,
    });
  });

  it("reports every expected job as stale for an empty log without throwing", () => {
    const findings = evaluateCronHealth([], now);
    expect(fingerprints(findings)).toEqual(
      EXPECTED_CRON_JOBS.map((job) => `cron:stale:${job.jobName}`).sort(),
    );
    expect(
      findings.every((finding) => finding.evidence.lastSuccessAt === null),
    ).toBe(true);
  });

  it("keeps fingerprints stable across runs with different row counts and timestamps", () => {
    const first = evaluateCronHealth(
      [
        row({
          job_name: HOURLY,
          request_id: 1,
          status_code: 500,
          created: hoursBefore(1),
        }),
      ],
      now,
    );
    const second = evaluateCronHealth(
      [
        row({
          job_name: HOURLY,
          request_id: 7,
          status_code: 502,
          created: hoursBefore(2),
        }),
        row({
          job_name: HOURLY,
          request_id: 8,
          status_code: 503,
          created: hoursBefore(2),
        }),
      ],
      new Date(now.getTime() + 60 * 60 * 1000),
    );
    // Only HOURLY appears in the log at all, and only as failures — so every
    // expected job is stale, HOURLY additionally failed.
    expect(fingerprints(first)).toEqual(fingerprints(second));
    expect(fingerprints(first)).toEqual(
      [
        `cron:failed:${HOURLY}`,
        ...EXPECTED_CRON_JOBS.map((job) => `cron:stale:${job.jobName}`),
      ].sort(),
    );
  });
});

describe("cron health collector", () => {
  it("returns success with no findings when every expected job is healthy", async () => {
    const result = await collectCronHealthArtifact(
      { outputPath: "cron-health.json", runAt },
      dependencyWithRows(healthyRows()),
    );

    expect(result).toMatchObject({
      evidence: {
        lookbackHours: CRON_HEALTH_LOOKBACK_HOURS,
        rowCount: EXPECTED_CRON_JOBS.length,
      },
      failures: [],
      findings: [],
      snapshot: {
        lookbackHours: CRON_HEALTH_LOOKBACK_HOURS,
        rowCount: EXPECTED_CRON_JOBS.length,
      },
      status: "success",
    });
  });

  it("treats an empty log as every job stale, not as a read failure", async () => {
    const result = await collectCronHealthArtifact(
      { outputPath: "cron-health.json", runAt },
      dependencyWithRows([]),
    );

    expect(result.status).toBe("success");
    expect(result.failures).toEqual([]);
    expect(fingerprints(result.findings)).toEqual(
      EXPECTED_CRON_JOBS.map((job) => `cron:stale:${job.jobName}`).sort(),
    );
  });

  it("surfaces a transport failure through the collector", async () => {
    const result = await collectCronHealthArtifact(
      { outputPath: "cron-health.json", runAt },
      dependencyWithRows([
        ...healthyRows(),
        row({
          job_name: WEEKLY,
          request_id: 9,
          status_code: null,
          timed_out: false,
          error_msg: "Could not resolve host: formoria.com",
        }),
      ]),
    );

    expect(result.status).toBe("success");
    expect(fingerprints(result.findings)).toEqual([`cron:failed:${WEEKLY}`]);
  });

  it("fails loudly when PostgREST cannot be read", async () => {
    const result = await collectCronHealthArtifact(
      { outputPath: "cron-health.json", runAt },
      {
        ...dependencyWithRows([]),
        fetchImplementation: async () =>
          new Response(JSON.stringify({ message: "permission denied" }), {
            headers: { "content-type": "application/json" },
            status: 403,
          }),
      },
    );

    expect(result.status).toBe("failed");
    expect(result.failures).toEqual(
      expect.arrayContaining([expect.any(String)]),
    );
    expect(result.failure).toContain("cron_http_log_read_failed");
    expect(result.findings).toEqual([]);
  });

  it("fails loudly when a row violates the expected shape", async () => {
    const result = await collectCronHealthArtifact(
      { outputPath: "cron-health.json", runAt },
      dependencyWithRows([
        { ...row({ job_name: HOURLY }), request_id: "not-a-number" },
      ]),
    );

    expect(result.status).toBe("failed");
    expect(result.failure).toContain("cron_http_log_row_invalid");
    expect(result.findings).toEqual([]);
  });
});
