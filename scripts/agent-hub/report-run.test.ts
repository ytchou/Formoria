import { describe, expect, it } from "vitest";

import {
  AgentHubMissingAgentError,
  AgentHubPausedAgentError,
  AgentHubStoreError,
  createAgentHubWriter,
} from "./writer.mjs";
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

function memoryStore({ agentStatus = "active", transientFailures = 0 } = {}) {
  const agents = [
    {
      id: "agent-growth-pulse",
      name: "growth-pulse",
      project: "formoria",
      status: agentStatus,
    },
  ];
  const rows: Record<string, unknown>[] = [];
  let calls = 0;
  let failures = transientFailures;

  return {
    get calls() {
      return calls;
    },
    rows,
    store: {
      async insertOrGetRun({
        agentName,
        project,
        sourceRunId,
        run,
      }: {
        agentName: string;
        project: string;
        sourceRunId: string;
        run: Record<string, unknown>;
      }) {
        calls += 1;
        if (failures > 0) {
          failures -= 1;
          throw new AgentHubStoreError("connection reset", {
            code: "ECONNRESET",
            retryable: true,
          });
        }
        const agent = agents.find(
          (candidate) =>
            candidate.name === agentName && candidate.project === project,
        );
        if (!agent) throw new AgentHubMissingAgentError(project, agentName);
        if (agent.status !== "active")
          throw new AgentHubPausedAgentError(project, agentName);
        const existing = rows.find(
          (candidate) =>
            candidate.agent_id === agent.id &&
            candidate.source_run_id === sourceRunId,
        );
        if (existing) {
          return { duplicate: true, run_id: String(existing.id) };
        }
        const runNumber =
          Math.max(
            0,
            ...rows
              .filter((candidate) => candidate.agent_id === agent.id)
              .map((candidate) => Number(candidate.run_number)),
          ) + 1;
        const persisted: Record<string, unknown> = {
          ...run,
          agent_id: agent.id,
          run_number: runNumber,
        };
        rows.push(persisted);
        return { duplicate: false, run_id: String(persisted.id) };
      },
    },
  };
}

function writerFor(
  boundary: ReturnType<typeof memoryStore>,
  records: unknown[] = [],
  options: Record<string, unknown> = {},
) {
  return createAgentHubWriter({
    logger: (record: unknown) => records.push(record),
    now: () => new Date("2026-07-15T00:00:00.000Z"),
    sleep: () => Promise.resolve(),
    store: boundary.store,
    ...options,
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

  it("writes real run data, returns the run ID, and returns the same ID for a replay", async () => {
    const boundary = memoryStore();
    const writer = writerFor(boundary);

    const first = await reportAgentRun(routineEnvelope(), { writer });
    const replay = await reportAgentRun(routineEnvelope(), { writer });

    expect(first).toMatchObject({
      duplicate: false,
      run_id: expect.any(String),
    });
    expect(replay).toEqual({ duplicate: true, run_id: first.run_id });
    expect(boundary.rows).toHaveLength(1);
    expect(boundary.rows[0]).toMatchObject({
      agent_id: "agent-growth-pulse",
      actions: [
        {
          desc: "Created Linear issue DEV-1234",
          path: "DEV-1234",
          type: "linear_issue",
        },
      ],
      metadata: { scorecard: { sessions: 42 }, source: "claude_routine" },
      run_number: 1,
      source_run_id: expect.stringMatching(/^claude-routine:growth-pulse:/),
      started_at: "2026-07-14T23:10:00.000Z",
      status: "success",
      summary: "Traffic is steady.",
      verdict_text: "Traffic is steady.",
    });
  });

  it("retries transient store failures with bounded backoff and redacts audit data", async () => {
    const boundary = memoryStore({ transientFailures: 2 });
    const records: unknown[] = [];
    const sleeps: number[] = [];
    const writer = writerFor(boundary, records, {
      secrets: ["scoped-secret-token"],
      sleep: (milliseconds: number) => {
        sleeps.push(milliseconds);
        return Promise.resolve();
      },
    });

    const result = await reportAgentRun(
      routineEnvelope({
        data: { scorecard: { sessions: 42 }, token: "scoped-secret-token" },
      }),
      { writer },
    );

    expect(result).toMatchObject({
      duplicate: false,
      run_id: expect.any(String),
    });
    expect(boundary.calls).toBe(3);
    expect(sleeps).toEqual([250, 500]);
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: "insert_agent_run",
          status: "failure",
          success: false,
        }),
        expect.objectContaining({
          operation: "insert_agent_run",
          status: "success",
          success: true,
        }),
      ]),
    );
    expect(JSON.stringify(records)).not.toContain("scoped-secret-token");
    expect(JSON.stringify(records)).toContain("Traffic is steady.");
  });

  it("does not retry invalid envelopes or inactive agents", async () => {
    const invalidBoundary = memoryStore();
    const invalidRecords: unknown[] = [];
    await expect(
      reportAgentRun(routineEnvelope({ status: "running" }), {
        writer: writerFor(invalidBoundary, invalidRecords),
      }),
    ).rejects.toThrow(new AgentHubReportError("status is invalid"));
    expect(invalidBoundary.calls).toBe(0);

    const pausedBoundary = memoryStore({ agentStatus: "paused" });
    const sleeps: number[] = [];
    await expect(
      reportAgentRun(routineEnvelope(), {
        writer: writerFor(pausedBoundary, [], {
          sleep: (milliseconds: number) => {
            sleeps.push(milliseconds);
            return Promise.resolve();
          },
        }),
      }),
    ).rejects.toBeInstanceOf(AgentHubPausedAgentError);
    expect(pausedBoundary.calls).toBe(1);
    expect(sleeps).toEqual([]);
  });

  it("rejects a logical report date that does not match run_at in Taipei", () => {
    expect(() =>
      normalizeRoutineEnvelope(routineEnvelope({ date: "2026-07-14" })),
    ).toThrowError(
      new AgentHubReportError("date must match run_at in Asia/Taipei"),
    );
  });
});
