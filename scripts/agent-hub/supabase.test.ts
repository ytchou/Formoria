import { describe, expect, it } from "vitest";

import { AgentHubSupabaseError, writeSupabaseAgentRun } from "./supabase.mjs";

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    data: { scorecard: { sessions: 42 } },
    date: "2026-07-15",
    project: "formoria",
    routine: "health-agent",
    run_at: "2026-07-14T23:10:00.000Z",
    source: "github_actions",
    source_run_id: "github-actions:health-agent:123:1",
    status: "success",
    tickets_created: [],
    verdict_severity: "ok",
    verdict_text: "Health is steady.",
    version: 1,
    ...overrides,
  };
}

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

describe("Supabase Agent Hub shadow writer", () => {
  // Bug caught: a retryable network, 429, or general 5xx failure can be
  // abandoned early or retried without the bounded exponential schedule.
  it("recovers from retryable boundary failures with bounded backoff", async () => {
    const records: Array<Record<string, unknown>> = [];
    const sleeps: number[] = [];
    let requests = 0;
    const expected = { duplicate: false, run_id: "supabase-run-123" };

    const result = await writeSupabaseAgentRun(envelope(), {
      fetchImplementation: async () => {
        requests += 1;
        if (requests === 1) throw new Error("socket reset");
        if (requests === 2) return jsonResponse(429, { error: "rate limited" });
        if (requests === 3)
          return jsonResponse(599, { error: "upstream unavailable" });
        return jsonResponse(201, expected);
      },
      logger: (record: Record<string, unknown>) => records.push(record),
      maxAttempts: 4,
      sleep: (milliseconds: number) => {
        sleeps.push(milliseconds);
        return Promise.resolve();
      },
      token: "supabase-shadow-token",
      url: "https://agent-hub.example/functions/v1/ingest-agent-run",
    });

    expect(result).toEqual(expected);
    expect(requests).toBe(4);
    expect(sleeps).toEqual([250, 500, 1_000]);
    expect(
      records.map((record) => ({
        attempt: record.attempt,
        destination: record.destination,
        event: record.event,
        operation: record.operation,
        status: record.status,
        success: record.success,
      })),
    ).toEqual([
      {
        attempt: 1,
        destination: "supabase",
        event: "agent_hub_write",
        operation: "ingest_envelope",
        status: "failure",
        success: false,
      },
      {
        attempt: 2,
        destination: "supabase",
        event: "agent_hub_write",
        operation: "ingest_envelope",
        status: "failure",
        success: false,
      },
      {
        attempt: 3,
        destination: "supabase",
        event: "agent_hub_write",
        operation: "ingest_envelope",
        status: "failure",
        success: false,
      },
      {
        attempt: 4,
        destination: "supabase",
        event: "agent_hub_write",
        operation: "ingest_envelope",
        status: "success",
        success: true,
      },
    ]);
  });

  // Bug caught: a permanent authentication or validation rejection can be
  // retried, hiding the real provider response and wasting delivery attempts.
  it("returns 4xx provider rejection without retrying", async () => {
    const cases = [
      { message: "scoped token rejected", status: 401 },
      { message: "envelope validation failed", status: 422 },
    ];

    for (const rejection of cases) {
      const records: Array<Record<string, unknown>> = [];
      const sleeps: number[] = [];
      let requests = 0;

      const operation = writeSupabaseAgentRun(envelope(), {
        fetchImplementation: async () => {
          requests += 1;
          return jsonResponse(rejection.status, { error: rejection.message });
        },
        logger: (record: Record<string, unknown>) => records.push(record),
        maxAttempts: 3,
        sleep: (milliseconds: number) => {
          sleeps.push(milliseconds);
          return Promise.resolve();
        },
        token: "supabase-shadow-token",
        url: "https://agent-hub.example/functions/v1/ingest-agent-run",
      });

      await expect(operation).rejects.toMatchObject({
        code: "supabase_write_failed",
        message: rejection.message,
        status: rejection.status,
      });
      expect(requests).toBe(1);
      expect(sleeps).toEqual([]);
      expect(records).toEqual([
        expect.objectContaining({
          attempt: 1,
          destination: "supabase",
          event: "agent_hub_write",
          operation: "ingest_envelope",
          status: "failure",
          success: false,
        }),
      ]);
    }
  });

  // Bug caught: a terminal timeout can leak the bearer token through the
  // thrown message or through an endpoint/query/body copied into audit data.
  it("returns a generic terminal network error and redacts every audit field", async () => {
    const token = "supabase-shadow-secret";
    const records: Array<Record<string, unknown>> = [];
    const sleeps: number[] = [];
    const url =
      "https://agent-hub.example/functions/v1/ingest-agent-run" +
      `?access_token=${encodeURIComponent(token)}`;
    let observedBody = "";
    let observedUrl = "";

    let caught: unknown;
    try {
      await writeSupabaseAgentRun(
        envelope({
          data: {
            diagnostic: `token=${token}`,
            endpoint: `https://agent-hub.example/replay?token=${token}`,
          },
        }),
        {
          fetchImplementation: async (requestUrl, init) => {
            observedUrl = String(requestUrl);
            observedBody = String(init?.body);
            throw Object.assign(new Error(`ETIMEDOUT authorization=${token}`), {
              code: "ETIMEDOUT",
            });
          },
          logger: (record: Record<string, unknown>) => records.push(record),
          maxAttempts: 2,
          sleep: (milliseconds: number) => {
            sleeps.push(milliseconds);
            return Promise.resolve();
          },
          token,
          url,
        },
      );
    } catch (error) {
      caught = error;
    }

    expect(observedUrl).toContain(token);
    expect(observedBody).toContain(token);
    expect(caught).toBeInstanceOf(AgentHubSupabaseError);
    expect(caught).toMatchObject({
      code: "supabase_write_failed",
      message: "Supabase Agent Hub request failed",
      status: null,
    });
    expect(sleeps).toEqual([250]);
    expect(records).toHaveLength(2);
    expect(records).toEqual(
      records.map((_, index) =>
        expect.objectContaining({
          attempt: index + 1,
          destination: "supabase",
          event: "agent_hub_write",
          operation: "ingest_envelope",
          status: "failure",
          success: false,
        }),
      ),
    );
    const auditJson = JSON.stringify(records);
    expect(auditJson).not.toContain(token);
    expect(auditJson).toContain("[REDACTED]");
  });

  // Bug caught: a malformed 2xx response can be counted as a successful
  // shadow write even though no valid run identity or duplicate flag exists.
  it("rejects malformed 2xx results without retrying or auditing success", async () => {
    const invalidResults = [
      { duplicate: false, run_id: 42 },
      { duplicate: "false", run_id: "supabase-run-123" },
    ];

    for (const invalidResult of invalidResults) {
      const records: Array<Record<string, unknown>> = [];
      const sleeps: number[] = [];
      let requests = 0;

      const operation = writeSupabaseAgentRun(envelope(), {
        fetchImplementation: async () => {
          requests += 1;
          return jsonResponse(200, invalidResult);
        },
        logger: (record: Record<string, unknown>) => records.push(record),
        maxAttempts: 3,
        sleep: (milliseconds: number) => {
          sleeps.push(milliseconds);
          return Promise.resolve();
        },
        token: "supabase-shadow-token",
        url: "https://agent-hub.example/functions/v1/ingest-agent-run",
      });

      await expect(operation).rejects.toMatchObject({
        code: "supabase_write_failed",
        message: "Supabase Agent Hub rejected the run",
        status: 200,
      });
      expect(requests).toBe(1);
      expect(sleeps).toEqual([]);
      expect(records).toEqual([
        expect.objectContaining({
          attempt: 1,
          destination: "supabase",
          event: "agent_hub_write",
          operation: "ingest_envelope",
          status: "failure",
          success: false,
        }),
      ]);
      expect(records.some((record) => record.status === "success")).toBe(false);
    }
  });
});
