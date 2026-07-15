import { describe, expect, it, vi } from "vitest";
import {
  AgentHubReportError,
  normalizeRoutineEnvelope,
  reportAgentRun,
} from "./report-run.mjs";

function routineEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    data: { scorecard: { sessions: 42 } },
    date: "2026-07-15",
    project: "formoria",
    routine: "growth-pulse",
    run_at: "2026-07-14T23:10:00.000Z",
    status: "success",
    tickets_created: ["DEV-1234"],
    verdict_severity: "ok",
    verdict_text: "Traffic is steady.",
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

describe("Agent Hub routine reporting", () => {
  it("normalizes a routine envelope into the versioned idempotent API contract", () => {
    const normalized = normalizeRoutineEnvelope(routineEnvelope());

    expect(normalized).toMatchObject({
      source: "claude_routine",
      source_run_id: expect.stringMatching(/^claude-routine:growth-pulse:/),
      version: 1,
    });
    expect(normalized.data).toEqual({ scorecard: { sessions: 42 } });
  });

  it("posts the payload with bearer auth and emits a redacted structured audit record", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      jsonResponse(201, { duplicate: false, run_id: "run-123" }),
    );
    const records: unknown[] = [];

    const result = await reportAgentRun(routineEnvelope(), {
      fetchImplementation,
      logger: (record) => records.push(record),
      sleep: () => Promise.resolve(),
      token: "scoped-secret-token",
      url: "https://agent-hub.test/functions/v1/ingest-agent-run",
    });

    expect(result).toEqual({ duplicate: false, run_id: "run-123" });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    const firstCall = fetchImplementation.mock.calls.at(0);
    expect(firstCall).toBeDefined();
    expect(new Headers(firstCall?.[1]?.headers).get("authorization")).toBe(
      "Bearer scoped-secret-token",
    );
    expect(JSON.stringify(records)).toContain("Traffic is steady.");
    expect(JSON.stringify(records)).toContain("run-123");
    expect(JSON.stringify(records)).not.toContain("scoped-secret-token");
  });

  it("retries network, 429, and 5xx failures before succeeding", async () => {
    const fetchImplementation = vi
      .fn()
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockResolvedValueOnce(jsonResponse(429, { error: "slow down" }))
      .mockResolvedValueOnce(jsonResponse(503, { error: "unavailable" }))
      .mockResolvedValueOnce(
        jsonResponse(200, { duplicate: true, run_id: "run-existing" }),
      );

    const result = await reportAgentRun(routineEnvelope(), {
      fetchImplementation,
      logger: () => undefined,
      maxAttempts: 4,
      sleep: () => Promise.resolve(),
      token: "scoped-secret-token",
      url: "https://agent-hub.test/functions/v1/ingest-agent-run",
    });

    expect(result).toEqual({ duplicate: true, run_id: "run-existing" });
    expect(fetchImplementation).toHaveBeenCalledTimes(4);
  });

  it("does not retry a validation or authentication response", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      jsonResponse(400, { error: "status is invalid" }),
    );

    await expect(
      reportAgentRun(routineEnvelope(), {
        fetchImplementation,
        logger: () => undefined,
        sleep: () => Promise.resolve(),
        token: "scoped-secret-token",
        url: "https://agent-hub.test/functions/v1/ingest-agent-run",
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it("rejects a logical report date that does not match run_at in Taipei", () => {
    expect(() =>
      normalizeRoutineEnvelope(routineEnvelope({ date: "2026-07-14" })),
    ).toThrowError(
      new AgentHubReportError("date must match run_at in Asia/Taipei"),
    );
  });
});
