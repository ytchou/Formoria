import { describe, expect, it } from "vitest";

import { collectCronHealthArtifact } from "./workflow-runtime";

const runAt = "2026-08-07T04:00:00.000Z";

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

describe("cron health collector", () => {
  it("reports non-2xx, timeout, and silence as separate stable findings", async () => {
    const result = await collectCronHealthArtifact(
      { outputPath: "cron-health.json", runAt },
      dependencyWithRows([
        {
          request_id: 1,
          job_name: "process-drips-daily",
          status_code: 401,
          timed_out: false,
          error_msg: null,
          created: runAt,
          logged_at: runAt,
        },
        {
          request_id: 2,
          job_name: "process-drips-daily",
          status_code: 401,
          timed_out: false,
          error_msg: null,
          created: runAt,
          logged_at: runAt,
        },
        {
          request_id: 3,
          job_name: "claim-proof-cleanup-hourly",
          status_code: 200,
          timed_out: true,
          error_msg: "timeout",
          created: runAt,
          logged_at: runAt,
        },
        {
          request_id: 4,
          job_name: "sync-mit-registry-weekly",
          status_code: null,
          timed_out: false,
          error_msg: "cron_http_no_response: pg_net recorded no response",
          created: null,
          logged_at: runAt,
        },
      ]),
    );

    expect(result.status).toBe("success");
    expect(result.findings).toHaveLength(3);
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fingerprint: "cron:non-2xx:process-drips-daily",
          severity: "high",
          source: "cron",
        }),
        expect.objectContaining({
          fingerprint: "cron:timeout:claim-proof-cleanup-hourly",
          severity: "medium",
          source: "cron",
        }),
        expect.objectContaining({
          fingerprint: "cron:silence:sync-mit-registry-weekly",
          severity: "high",
          source: "cron",
        }),
      ]),
    );
  });

  it("returns success with no findings for a clean log", async () => {
    const result = await collectCronHealthArtifact(
      { outputPath: "cron-health.json", runAt },
      dependencyWithRows([
        {
          request_id: 1,
          job_name: "claim-proof-cleanup-hourly",
          status_code: 204,
          timed_out: false,
          error_msg: null,
          created: runAt,
          logged_at: runAt,
        },
      ]),
    );

    expect(result).toMatchObject({ status: "success", findings: [], failures: [] });
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
    expect(result.failures).toEqual(expect.arrayContaining([expect.any(String)]));
    expect(result.findings).toEqual([]);
  });
});
