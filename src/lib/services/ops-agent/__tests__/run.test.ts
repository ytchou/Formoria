import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/audit", () => ({
  auditedCall: vi
    .fn()
    .mockImplementation(
      (_spec: unknown, fn: (ctx: { summary: Record<string, unknown> }) => unknown) =>
        fn({ summary: {} }),
    ),
}));

vi.mock("@/lib/langfuse/prompt", () => ({
  fetchLangfusePromptWithMeta: vi.fn().mockResolvedValue({
    text: "You are the ops agent.",
    prompt: { name: "ops-agent-system", version: 1, source: "snapshot" },
  }),
}));

import { runOpsAgent, formatThreadHistory, type RunOpsAgentDeps } from "../run";
import type { GraphResult } from "../graph";
import type { OpsRequestRow } from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest() {
  return {
    id: "req-1",
    status: "received" as const,
    channelId: "C_OPS",
    threadTs: "1234.5678",
    text: "how is the system",
    slackUserId: "U1",
    operatorEmail: "a@x.com",
    slackEventId: null,
    cardTs: null,
    result: null,
    proposal: null,
    toolCalls: [],
    modelCalls: 0,
    costUsd: 0,
    sessionUrl: null,
    dispatchedAt: null,
    dispatchClaimedAt: null,
    dispatchRunId: null,
    dispatchCompletedAt: null,
    completedAt: null,
    correlationId: null,
    expiresAt: null,
    createdAt: "2026-09-15T00:00:00Z",
    updatedAt: "2026-09-15T00:00:00Z",
  };
}

function fakeModel() {
  return {
    invoke: vi.fn().mockResolvedValue({
      content: "All systems healthy.",
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    }),
  };
}

// ---------------------------------------------------------------------------
// Test 7: wall_clock_signal_aborts
// ---------------------------------------------------------------------------

describe("runOpsAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPS_ROUTINE_ID = "test-routine-id";
  });

  afterEach(() => {
    delete process.env.OPS_ROUTINE_ID;
  });

  it("signal abort yields failed and nothing thrown", async () => {
    const graphResult: GraphResult = {
      kind: "failed",
      modelCalls: 0,
      toolLog: [],
      promptTokens: 0,
      completionTokens: 0,
    };

    const deps: RunOpsAgentDeps = {
      getRequest: vi.fn().mockResolvedValue(makeRequest()),
      transitionRequest: vi.fn().mockImplementation(
        async (_id: string, _from: string[], to: string, patch?: Record<string, unknown>) => ({
          ...makeRequest(),
          status: to,
          ...patch,
        }),
      ),
      expireStale: vi.fn(),
      postMessage: vi.fn(),
      createOpsTools: vi.fn().mockReturnValue([]),
      createAgentModel: vi.fn().mockResolvedValue(fakeModel()),
      getThreadHistory: vi.fn().mockResolvedValue([]),
      runGraph: vi.fn().mockResolvedValue(graphResult),
    };

    const result = await runOpsAgent("req-1", deps);
    expect(result.kind).toBe("failed");
    // Should not throw
  });

  it("appends English language constraint to the system prompt", async () => {
    const graphResult: GraphResult = {
      kind: "answer",
      text: "ok",
      modelCalls: 1,
      toolLog: [],
      promptTokens: 0,
      completionTokens: 0,
    };

    const runGraphMock = vi.fn().mockResolvedValue(graphResult);
    const deps: RunOpsAgentDeps = {
      getRequest: vi.fn().mockResolvedValue(makeRequest()),
      transitionRequest: vi.fn().mockImplementation(
        async (_id: string, _from: string[], to: string, patch?: Record<string, unknown>) => ({
          ...makeRequest(),
          status: to,
          ...patch,
        }),
      ),
      expireStale: vi.fn(),
      postMessage: vi.fn(),
      createOpsTools: vi.fn().mockReturnValue([]),
      createAgentModel: vi.fn().mockResolvedValue(fakeModel()),
      getThreadHistory: vi.fn().mockResolvedValue([]),
      runGraph: runGraphMock,
    };

    await runOpsAgent("req-1", deps);

    const passedPrompt = runGraphMock.mock.calls[0][2] as string;
    expect(passedPrompt).toContain("Always respond in English");
  });

  // ---------------------------------------------------------------------------
  // Test 8: run_ops_agent_persists_outcome
  // ---------------------------------------------------------------------------

  it("persists answered outcome with model_calls and tool_calls", async () => {
    const graphResult: GraphResult = {
      kind: "answer",
      text: "Everything is fine.",
      modelCalls: 2,
      toolLog: [{ name: "system_status", ms: 100, bytes: 50 }],
      promptTokens: 0,
      completionTokens: 0,
    };

    const transitions: Array<{ to: string }> = [];
    const deps: RunOpsAgentDeps = {
      getRequest: vi.fn().mockResolvedValue(makeRequest()),
      transitionRequest: vi.fn().mockImplementation(
        async (_id: string, _from: string[], to: string, patch?: Record<string, unknown>) => {
          transitions.push({ to });
          return { ...makeRequest(), status: to, ...patch };
        },
      ),
      expireStale: vi.fn(),
      postMessage: vi.fn(),
      createOpsTools: vi.fn().mockReturnValue([]),
      createAgentModel: vi.fn().mockResolvedValue(fakeModel()),
      getThreadHistory: vi.fn().mockResolvedValue([]),
      runGraph: vi.fn().mockResolvedValue(graphResult),
    };

    const result = await runOpsAgent("req-1", deps);
    expect(result.kind).toBe("answer");

    // Transitions: received -> running, then running -> answered
    expect(transitions).toEqual([{ to: "running" }, { to: "answered" }]);

    // Posts exactly one Slack message
    expect(deps.postMessage).toHaveBeenCalledOnce();
  });

  it("persists proposal outcome with awaiting_confirm and expires_at", async () => {
    const graphResult: GraphResult = {
      kind: "proposal",
      proposal: { kind: "refresh_brand", slug: "test-brand" },
      rationale: "Brand data is stale",
      modelCalls: 3,
      toolLog: [
        { name: "brand_context", ms: 80, bytes: 200 },
        { name: "propose_action", ms: 10, bytes: 50 },
      ],
      promptTokens: 0,
      completionTokens: 0,
    };

    const transitionPatches: Array<Record<string, unknown>> = [];
    const deps: RunOpsAgentDeps = {
      getRequest: vi.fn().mockResolvedValue(makeRequest()),
      transitionRequest: vi.fn().mockImplementation(
        async (_id: string, _from: string[], to: string, patch?: Record<string, unknown>) => {
          if (patch) transitionPatches.push(patch);
          return { ...makeRequest(), status: to, ...patch };
        },
      ),
      expireStale: vi.fn(),
      postMessage: vi.fn().mockResolvedValue("1234.9999"),
      renderProposalCard: vi.fn().mockReturnValue([{ type: "section", text: "card" }]),
      createOpsTools: vi.fn().mockReturnValue([]),
      createAgentModel: vi.fn().mockResolvedValue(fakeModel()),
      getThreadHistory: vi.fn().mockResolvedValue([]),
      runGraph: vi.fn().mockResolvedValue(graphResult),
    };

    const result = await runOpsAgent("req-1", deps);
    expect(result.kind).toBe("proposal");

    // Should transition to awaiting_confirm with proposal and expires_at
    const awaitPatch = transitionPatches.find((p) => p.proposal !== undefined);
    expect(awaitPatch).toBeDefined();
    expect(awaitPatch!.expiresAt).toBeDefined();
    expect(awaitPatch!.proposal).toBeDefined();

    // Posts exactly one Slack message
    expect(deps.postMessage).toHaveBeenCalledWith(
      "1234.5678",
      expect.any(String),
      [{ type: "section", text: "card" }],
    );
  });

  // ---------------------------------------------------------------------------
  // Repair request detection
  // ---------------------------------------------------------------------------

  const VALID_REPAIR_TEXT = [
    "```json",
    JSON.stringify({
      agent: "health",
      ref: "abc123",
      runId: "run-1",
      scope: ["src/lib/foo.ts"],
      findings: [
        {
          fingerprint: "fp1",
          title: "unused export",
          severity: "warn",
          source: "knip",
        },
      ],
    }),
    "```",
  ].join("\n");

  it("system_bot_repair_fires_routine", async () => {
    const fireRoutine = vi.fn().mockResolvedValue({
      sessionUrl: "https://claude.ai/code/session/repair-1",
    });
    const deps: RunOpsAgentDeps = {
      getRequest: vi.fn().mockResolvedValue({
        ...makeRequest(),
        operatorEmail: "system:bot",
        text: VALID_REPAIR_TEXT,
      }),
      transitionRequest: vi.fn().mockImplementation(
        async (_id: string, _from: string[], to: string, patch?: Record<string, unknown>) => ({
          ...makeRequest(),
          status: to,
          ...patch,
        }),
      ),
      expireStale: vi.fn(),
      postMessage: vi.fn(),
      createOpsTools: vi.fn().mockReturnValue([]),
      createAgentModel: vi.fn().mockResolvedValue(fakeModel()),
      getThreadHistory: vi.fn().mockResolvedValue([]),
      runGraph: vi.fn(),
      fireRoutine,
    };

    const result = await runOpsAgent("req-1", deps);

    // runGraph NOT called
    expect(deps.runGraph).not.toHaveBeenCalled();

    // fireRoutine called once with JSON containing the repair payload
    expect(fireRoutine).toHaveBeenCalledOnce();
    expect(fireRoutine).toHaveBeenCalledWith({
      routineId: "test-routine-id",
      text: expect.stringContaining('"agent":"health"'),
    });

    // Posts Block Kit acknowledgment with session URL
    const repairMsg = (deps.postMessage as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && c[1].includes("repair-1"),
    );
    expect(repairMsg).toBeDefined();
    expect(repairMsg![1]).toContain("1 findings");
    // Block Kit blocks passed as third argument
    const blocks = repairMsg![2] as Record<string, unknown>[];
    expect(blocks).toBeDefined();
    expect(blocks[0]).toMatchObject({ type: "header" });
    expect(blocks[1]).toMatchObject({ type: "section" });

    // Transitions to answered (not failed)
    expect(deps.transitionRequest).toHaveBeenCalledWith(
      "req-1",
      ["running"],
      "answered",
      expect.objectContaining({
        result: expect.objectContaining({ sessionUrl: "https://claude.ai/code/session/repair-1" }),
      }),
    );

    expect(result.kind).toBe("answer");
    expect(result.modelCalls).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Run timeline events on the repair path
  // ---------------------------------------------------------------------------

  const TIMELINE = { channel: "C_HEALTH", ts: "1700000000.000100" };

  function repairTextWith(extra: Record<string, unknown>) {
    return [
      "```json",
      JSON.stringify({
        agent: "e2e-agent",
        ref: "staging",
        runId: "run-2",
        scope: ["e2e/tests/brands.spec.ts"],
        findings: [
          { fingerprint: "fp1", title: "brand page loads", severity: "high", source: "e2e" },
        ],
        ...extra,
      }),
      "```",
    ].join("\n");
  }

  function repairDeps(text: string, overrides: Partial<RunOpsAgentDeps> = {}): RunOpsAgentDeps {
    return {
      getRequest: vi.fn().mockResolvedValue({
        ...makeRequest(),
        operatorEmail: "system:bot",
        text,
      }),
      transitionRequest: vi.fn().mockImplementation(
        async (_id: string, _from: string[], to: string, patch?: Record<string, unknown>) => ({
          ...makeRequest(),
          status: to,
          ...patch,
        }),
      ),
      expireStale: vi.fn(),
      postMessage: vi.fn(),
      createOpsTools: vi.fn().mockReturnValue([]),
      createAgentModel: vi.fn().mockResolvedValue(fakeModel()),
      getThreadHistory: vi.fn().mockResolvedValue([]),
      runGraph: vi.fn(),
      fireRoutine: vi.fn().mockResolvedValue({
        sessionUrl: "https://claude.ai/code/session/repair-2",
      }),
      appendRunEvent: vi.fn().mockResolvedValue(true),
      ...overrides,
    };
  }

  it("appends repair_started with the session url when the request carries a timeline", async () => {
    const deps = repairDeps(repairTextWith({ timeline: TIMELINE }));

    const result = await runOpsAgent("req-1", deps);

    expect(result.kind).toBe("answer");
    expect(deps.appendRunEvent).toHaveBeenCalledOnce();
    expect(deps.appendRunEvent).toHaveBeenCalledWith(TIMELINE, {
      kind: "repair_started",
      at: expect.any(Number),
      sessionUrl: "https://claude.ai/code/session/repair-2",
    });
    // repair_started is appended after the routine fires
    const fireOrder = (deps.fireRoutine as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    const appendOrder = (deps.appendRunEvent as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0];
    expect(appendOrder).toBeGreaterThan(fireOrder);
  });

  it("appends repair_failed when the routine fails to fire", async () => {
    const deps = repairDeps(repairTextWith({ timeline: TIMELINE }), {
      fireRoutine: vi.fn().mockRejectedValue(new Error("routine 503")),
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await runOpsAgent("req-1", deps);

    expect(result.kind).toBe("failed");
    expect(deps.appendRunEvent).toHaveBeenCalledOnce();
    expect(deps.appendRunEvent).toHaveBeenCalledWith(TIMELINE, {
      kind: "repair_failed",
      at: expect.any(Number),
      reason: "routine 503",
    });
    error.mockRestore();
  });

  it("does not append repair_failed when the routine fired but a later step failed", async () => {
    const transition = vi.fn().mockImplementation(
      async (_id: string, _from: string[], to: string, patch?: Record<string, unknown>) => {
        if (to === "answered") throw new Error("db down");
        return { ...makeRequest(), status: to, ...patch };
      },
    );
    const deps = repairDeps(repairTextWith({ timeline: TIMELINE }), {
      transitionRequest: transition,
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await runOpsAgent("req-1", deps);

    const kinds = (deps.appendRunEvent as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => (c[1] as { kind: string }).kind,
    );
    expect(kinds).toEqual(["repair_started"]);
    error.mockRestore();
  });

  it.each([
    ["success", undefined],
    ["fire failure", vi.fn().mockRejectedValue(new Error("routine 503"))],
  ] as const)(
    "does not append timeline events without a timeline (%s)",
    async (_name, fireRoutine) => {
      const deps = repairDeps(
        repairTextWith({}),
        fireRoutine ? { fireRoutine } : {},
      );
      const error = vi.spyOn(console, "error").mockImplementation(() => {});

      await runOpsAgent("req-1", deps);

      expect(deps.appendRunEvent).not.toHaveBeenCalled();
      error.mockRestore();
    },
  );

  it("posts the repair-routine failure notice as Block Kit", async () => {
    const deps = repairDeps(repairTextWith({ timeline: TIMELINE }), {
      fireRoutine: vi.fn().mockRejectedValue(new Error("routine 503")),
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await runOpsAgent("req-1", deps);

    const calls = (deps.postMessage as ReturnType<typeof vi.fn>).mock.calls;
    const notice = calls.find(
      (c: unknown[]) => typeof c[1] === "string" && c[1].includes("Failed to start repair routine"),
    );
    expect(notice).toBeDefined();
    const blocks = notice![2] as Record<string, unknown>[];
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks[0]).toMatchObject({ type: "header" });
    expect(JSON.stringify(blocks)).toContain("run-2");
    error.mockRestore();
  });

  it("posts the start-processing failure notice as Block Kit", async () => {
    const deps = repairDeps(repairTextWith({ timeline: TIMELINE }), {
      transitionRequest: vi.fn().mockRejectedValue(new Error("already running")),
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await runOpsAgent("req-1", deps);

    expect(result.kind).toBe("failed");
    const calls = (deps.postMessage as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toContain("Failed to start processing");
    const blocks = calls[0][2] as Record<string, unknown>[];
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks[0]).toMatchObject({ type: "header" });
    expect(deps.appendRunEvent).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("malformed_json_system_bot_refuses", async () => {
    const malformedText = "```json\n{not valid json\n```";

    const transitions: Array<{ to: string }> = [];
    const deps: RunOpsAgentDeps = {
      getRequest: vi.fn().mockResolvedValue({
        ...makeRequest(),
        operatorEmail: "system:bot",
        text: malformedText,
      }),
      transitionRequest: vi.fn().mockImplementation(
        async (_id: string, _from: string[], to: string, patch?: Record<string, unknown>) => {
          transitions.push({ to });
          return { ...makeRequest(), status: to, ...patch };
        },
      ),
      expireStale: vi.fn(),
      postMessage: vi.fn(),
      createOpsTools: vi.fn().mockReturnValue([]),
      createAgentModel: vi.fn().mockResolvedValue(fakeModel()),
      getThreadHistory: vi.fn().mockResolvedValue([]),
      runGraph: vi.fn(),
    };

    const result = await runOpsAgent("req-1", deps);

    // runGraph NOT called
    expect(deps.runGraph).not.toHaveBeenCalled();

    // Transitions: received → running, running → refused
    expect(transitions).toEqual([{ to: "running" }, { to: "refused" }]);

    expect(result.kind).toBe("refused");
    expect(result.modelCalls).toBe(0);
  });

  it("human_text_uses_llm_path", async () => {
    const graphResult: GraphResult = {
      kind: "answer",
      text: "Here is the answer.",
      modelCalls: 1,
      toolLog: [],
      promptTokens: 0,
      completionTokens: 0,
    };

    const deps: RunOpsAgentDeps = {
      getRequest: vi.fn().mockResolvedValue({
        ...makeRequest(),
        operatorEmail: "op@formoria.com",
        text: "how is the system",
      }),
      transitionRequest: vi.fn().mockImplementation(
        async (_id: string, _from: string[], to: string, patch?: Record<string, unknown>) => ({
          ...makeRequest(),
          status: to,
          ...patch,
        }),
      ),
      expireStale: vi.fn(),
      postMessage: vi.fn(),
      createOpsTools: vi.fn().mockReturnValue([]),
      createAgentModel: vi.fn().mockResolvedValue(fakeModel()),
      getThreadHistory: vi.fn().mockResolvedValue([]),
      runGraph: vi.fn().mockResolvedValue(graphResult),
    };

    const result = await runOpsAgent("req-1", deps);

    // runGraph IS called
    expect(deps.runGraph).toHaveBeenCalledOnce();
    expect(result.kind).toBe("answer");
  });

  it("routine_result_fires_routine_and_posts_url", async () => {
    const graphResult: GraphResult = {
      kind: "routine",
      description: "Investigate brand images",
      lastAssistantText: "I'll delegate this to a Routine.",
      modelCalls: 2,
      toolLog: [],
      promptTokens: 0,
      completionTokens: 0,
    };

    const fireRoutine = vi.fn().mockResolvedValue({
      sessionUrl: "https://claude.ai/code/session/abc",
    });

    const deps: RunOpsAgentDeps = {
      getRequest: vi.fn().mockResolvedValue(makeRequest()),
      transitionRequest: vi.fn().mockImplementation(
        async (_id: string, _from: string[], to: string, patch?: Record<string, unknown>) => ({
          ...makeRequest(),
          status: to,
          ...patch,
        }),
      ),
      expireStale: vi.fn(),
      postMessage: vi.fn(),
      createOpsTools: vi.fn().mockReturnValue([]),
      createAgentModel: vi.fn().mockResolvedValue(fakeModel()),
      getThreadHistory: vi.fn().mockResolvedValue([]),
      runGraph: vi.fn().mockResolvedValue(graphResult),
      fireRoutine,
    };

    const result = await runOpsAgent("req-1", deps);
    expect(result.kind).toBe("routine");

    // fireRoutine called with correct params
    expect(fireRoutine).toHaveBeenCalledWith({
      routineId: "test-routine-id",
      text: expect.stringContaining("Investigate brand images"),
    });

    // Posts reasoning + session URL to Slack
    const routineMsg = (deps.postMessage as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && c[1].includes("session/abc"),
    );
    expect(routineMsg).toBeDefined();
    expect(routineMsg![1]).toContain("Investigate brand images");
    expect(routineMsg![1]).toContain("https://claude.ai/code/session/abc");

    // Transitions to answered with sessionUrl in result
    expect(deps.transitionRequest).toHaveBeenCalledWith(
      "req-1",
      ["running"],
      "answered",
      expect.objectContaining({
        result: expect.objectContaining({ sessionUrl: "https://claude.ai/code/session/abc" }),
      }),
    );
  });

  it("routine_api_failure_transitions_to_failed", async () => {
    const graphResult: GraphResult = {
      kind: "routine",
      description: "Investigate brand images",
      lastAssistantText: "I'll delegate this to a Routine.",
      modelCalls: 2,
      toolLog: [],
      promptTokens: 0,
      completionTokens: 0,
    };

    const fireRoutine = vi.fn().mockRejectedValue(new Error("Routines API error (500)"));

    const deps: RunOpsAgentDeps = {
      getRequest: vi.fn().mockResolvedValue(makeRequest()),
      transitionRequest: vi.fn().mockImplementation(
        async (_id: string, _from: string[], to: string, patch?: Record<string, unknown>) => ({
          ...makeRequest(),
          status: to,
          ...patch,
        }),
      ),
      expireStale: vi.fn(),
      postMessage: vi.fn(),
      createOpsTools: vi.fn().mockReturnValue([]),
      createAgentModel: vi.fn().mockResolvedValue(fakeModel()),
      getThreadHistory: vi.fn().mockResolvedValue([]),
      runGraph: vi.fn().mockResolvedValue(graphResult),
      fireRoutine,
    };

    const result = await runOpsAgent("req-1", deps);
    expect(result.kind).toBe("routine");

    // Transitions to failed
    expect(deps.transitionRequest).toHaveBeenCalledWith(
      "req-1",
      ["running"],
      "failed",
      expect.objectContaining({
        result: expect.objectContaining({
          error: "Routines API error (500)",
        }),
      }),
    );

    // Posts error message
    expect(deps.postMessage).toHaveBeenCalledWith(
      "1234.5678",
      expect.stringContaining("Failed"),
    );
  });

  it("answer reply includes tool chain and turn count", async () => {
    const graphResult: GraphResult = {
      kind: "answer",
      text: "All healthy.",
      modelCalls: 2,
      toolLog: [
        { name: "system_status", ms: 80, bytes: 100 },
        { name: "job_detail", ms: 50, bytes: 200 },
      ],
      promptTokens: 500,
      completionTokens: 100,
    };

    const deps: RunOpsAgentDeps = {
      getRequest: vi.fn().mockResolvedValue(makeRequest()),
      transitionRequest: vi.fn().mockImplementation(
        async (_id: string, _from: string[], to: string, patch?: Record<string, unknown>) => ({
          ...makeRequest(),
          status: to,
          ...patch,
        }),
      ),
      expireStale: vi.fn(),
      postMessage: vi.fn(),
      createOpsTools: vi.fn().mockReturnValue([]),
      createAgentModel: vi.fn().mockResolvedValue(fakeModel()),
      getThreadHistory: vi.fn().mockResolvedValue([]),
      runGraph: vi.fn().mockResolvedValue(graphResult),
    };

    await runOpsAgent("req-1", deps);

    const msg = (deps.postMessage as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(msg).toMatch(/^system_status → job_detail \(2 turns, \$0\.000\)\n/);
  });

  it("answer reply with no tools shows only turn count", async () => {
    const graphResult: GraphResult = {
      kind: "answer",
      text: "Hello.",
      modelCalls: 1,
      toolLog: [],
      promptTokens: 0,
      completionTokens: 0,
    };

    const deps: RunOpsAgentDeps = {
      getRequest: vi.fn().mockResolvedValue(makeRequest()),
      transitionRequest: vi.fn().mockImplementation(
        async (_id: string, _from: string[], to: string, patch?: Record<string, unknown>) => ({
          ...makeRequest(),
          status: to,
          ...patch,
        }),
      ),
      expireStale: vi.fn(),
      postMessage: vi.fn(),
      createOpsTools: vi.fn().mockReturnValue([]),
      createAgentModel: vi.fn().mockResolvedValue(fakeModel()),
      getThreadHistory: vi.fn().mockResolvedValue([]),
      runGraph: vi.fn().mockResolvedValue(graphResult),
    };

    await runOpsAgent("req-1", deps);

    const msg = (deps.postMessage as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(msg).toMatch(/^\(1 turn\)\n/);
  });

  it("routine reply includes tool chain before description", async () => {
    const graphResult: GraphResult = {
      kind: "routine",
      description: "Investigate curation job",
      lastAssistantText: "",
      modelCalls: 3,
      toolLog: [
        { name: "system_status", ms: 80, bytes: 100 },
        { name: "job_detail", ms: 50, bytes: 200 },
      ],
      promptTokens: 0,
      completionTokens: 0,
    };

    const fireRoutine = vi.fn().mockResolvedValue({
      sessionUrl: "https://claude.ai/code/session/xyz",
    });

    const deps: RunOpsAgentDeps = {
      getRequest: vi.fn().mockResolvedValue(makeRequest()),
      transitionRequest: vi.fn().mockImplementation(
        async (_id: string, _from: string[], to: string, patch?: Record<string, unknown>) => ({
          ...makeRequest(),
          status: to,
          ...patch,
        }),
      ),
      expireStale: vi.fn(),
      postMessage: vi.fn(),
      createOpsTools: vi.fn().mockReturnValue([]),
      createAgentModel: vi.fn().mockResolvedValue(fakeModel()),
      getThreadHistory: vi.fn().mockResolvedValue([]),
      runGraph: vi.fn().mockResolvedValue(graphResult),
      fireRoutine,
    };

    await runOpsAgent("req-1", deps);

    const msg = (deps.postMessage as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(msg).toMatch(/^system_status → job_detail \(3 turns\)\n/);
    expect(msg).toContain("Investigate curation job");
    expect(msg).toContain("session/xyz");
  });

  it("tool chain deduplicates repeated tool names", async () => {
    const graphResult: GraphResult = {
      kind: "answer",
      text: "Done.",
      modelCalls: 3,
      toolLog: [
        { name: "system_status", ms: 80, bytes: 100 },
        { name: "brand_context", ms: 50, bytes: 200 },
        { name: "system_status", ms: 40, bytes: 90 },
      ],
      promptTokens: 0,
      completionTokens: 0,
    };

    const deps: RunOpsAgentDeps = {
      getRequest: vi.fn().mockResolvedValue(makeRequest()),
      transitionRequest: vi.fn().mockImplementation(
        async (_id: string, _from: string[], to: string, patch?: Record<string, unknown>) => ({
          ...makeRequest(),
          status: to,
          ...patch,
        }),
      ),
      expireStale: vi.fn(),
      postMessage: vi.fn(),
      createOpsTools: vi.fn().mockReturnValue([]),
      createAgentModel: vi.fn().mockResolvedValue(fakeModel()),
      getThreadHistory: vi.fn().mockResolvedValue([]),
      runGraph: vi.fn().mockResolvedValue(graphResult),
    };

    await runOpsAgent("req-1", deps);

    const msg = (deps.postMessage as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(msg).toMatch(/^system_status → brand_context \(3 turns\)\n/);
  });

  it("cost is shown when tokens are non-zero", async () => {
    // 10000 prompt + 2000 completion at gpt-4o-mini rates:
    // (10000 * 0.15 + 2000 * 0.60) / 1_000_000 = 0.0027
    const graphResult: GraphResult = {
      kind: "answer",
      text: "Status report.",
      modelCalls: 3,
      toolLog: [{ name: "system_status", ms: 80, bytes: 100 }],
      promptTokens: 10000,
      completionTokens: 2000,
    };

    const deps: RunOpsAgentDeps = {
      getRequest: vi.fn().mockResolvedValue(makeRequest()),
      transitionRequest: vi.fn().mockImplementation(
        async (_id: string, _from: string[], to: string, patch?: Record<string, unknown>) => ({
          ...makeRequest(),
          status: to,
          ...patch,
        }),
      ),
      expireStale: vi.fn(),
      postMessage: vi.fn(),
      createOpsTools: vi.fn().mockReturnValue([]),
      createAgentModel: vi.fn().mockResolvedValue(fakeModel()),
      getThreadHistory: vi.fn().mockResolvedValue([]),
      runGraph: vi.fn().mockResolvedValue(graphResult),
    };

    await runOpsAgent("req-1", deps);

    const msg = (deps.postMessage as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(msg).toMatch(/^system_status \(3 turns, \$0\.003\)\n/);
  });

  it("cost is omitted when tokens are zero", async () => {
    const graphResult: GraphResult = {
      kind: "answer",
      text: "Quick answer.",
      modelCalls: 1,
      toolLog: [{ name: "system_status", ms: 50, bytes: 80 }],
      promptTokens: 0,
      completionTokens: 0,
    };

    const deps: RunOpsAgentDeps = {
      getRequest: vi.fn().mockResolvedValue(makeRequest()),
      transitionRequest: vi.fn().mockImplementation(
        async (_id: string, _from: string[], to: string, patch?: Record<string, unknown>) => ({
          ...makeRequest(),
          status: to,
          ...patch,
        }),
      ),
      expireStale: vi.fn(),
      postMessage: vi.fn(),
      createOpsTools: vi.fn().mockReturnValue([]),
      createAgentModel: vi.fn().mockResolvedValue(fakeModel()),
      getThreadHistory: vi.fn().mockResolvedValue([]),
      runGraph: vi.fn().mockResolvedValue(graphResult),
    };

    await runOpsAgent("req-1", deps);

    const msg = (deps.postMessage as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(msg).toMatch(/^system_status \(1 turn\)\n/);
    expect(msg).not.toContain("$");
  });

  it("human_with_valid_repair_json_uses_llm_path", async () => {
    const graphResult: GraphResult = {
      kind: "answer",
      text: "I see that repair request.",
      modelCalls: 1,
      toolLog: [],
      promptTokens: 0,
      completionTokens: 0,
    };

    const deps: RunOpsAgentDeps = {
      getRequest: vi.fn().mockResolvedValue({
        ...makeRequest(),
        operatorEmail: "op@formoria.com",
        text: VALID_REPAIR_TEXT,
      }),
      transitionRequest: vi.fn().mockImplementation(
        async (_id: string, _from: string[], to: string, patch?: Record<string, unknown>) => ({
          ...makeRequest(),
          status: to,
          ...patch,
        }),
      ),
      expireStale: vi.fn(),
      postMessage: vi.fn(),
      createOpsTools: vi.fn().mockReturnValue([]),
      createAgentModel: vi.fn().mockResolvedValue(fakeModel()),
      getThreadHistory: vi.fn().mockResolvedValue([]),
      runGraph: vi.fn().mockResolvedValue(graphResult),
    };

    const result = await runOpsAgent("req-1", deps);

    // runGraph IS called — human operators always use the LLM path
    expect(deps.runGraph).toHaveBeenCalledOnce();

    expect(result.kind).toBe("answer");
  });

  // ---------------------------------------------------------------------------
  // Thread history injection
  // ---------------------------------------------------------------------------

  it("passes prior messages to graph", async () => {
    const historyRows: OpsRequestRow[] = [
      {
        ...makeRequest(),
        id: "req-0",
        status: "answered" as const,
        text: "what is brand X",
        result: { text: "Brand X is a snack brand.", toolCalls: [], modelCalls: 1 },
      },
    ];

    const runGraphMock = vi.fn().mockResolvedValue({
      kind: "answer",
      text: "Follow up answer.",
      modelCalls: 1,
      toolLog: [],
      promptTokens: 0,
      completionTokens: 0,
    } as GraphResult);

    const deps: RunOpsAgentDeps = {
      getRequest: vi.fn().mockResolvedValue(makeRequest()),
      transitionRequest: vi.fn().mockImplementation(
        async (_id: string, _from: string[], to: string, patch?: Record<string, unknown>) => ({
          ...makeRequest(),
          status: to,
          ...patch,
        }),
      ),
      expireStale: vi.fn(),
      postMessage: vi.fn(),
      createOpsTools: vi.fn().mockReturnValue([]),
      createAgentModel: vi.fn().mockResolvedValue(fakeModel()),
      getThreadHistory: vi.fn().mockResolvedValue(historyRows),
      runGraph: runGraphMock,
    };

    await runOpsAgent("req-1", deps);

    const priorMessages = runGraphMock.mock.calls[0][5];
    expect(priorMessages).toEqual([
      { role: "user", content: "what is brand X" },
      { role: "assistant", content: "Brand X is a snack brand." },
    ]);

    // Thread-awareness guard should be in system prompt
    const passedPrompt = runGraphMock.mock.calls[0][2] as string;
    expect(passedPrompt).toContain("Prior messages in this thread are context only");
  });

  it("passes empty priorMessages for first message in thread", async () => {
    const runGraphMock = vi.fn().mockResolvedValue({
      kind: "answer",
      text: "ok",
      modelCalls: 1,
      toolLog: [],
      promptTokens: 0,
      completionTokens: 0,
    } as GraphResult);

    const deps: RunOpsAgentDeps = {
      getRequest: vi.fn().mockResolvedValue(makeRequest()),
      transitionRequest: vi.fn().mockImplementation(
        async (_id: string, _from: string[], to: string, patch?: Record<string, unknown>) => ({
          ...makeRequest(),
          status: to,
          ...patch,
        }),
      ),
      expireStale: vi.fn(),
      postMessage: vi.fn(),
      createOpsTools: vi.fn().mockReturnValue([]),
      createAgentModel: vi.fn().mockResolvedValue(fakeModel()),
      getThreadHistory: vi.fn().mockResolvedValue([]),
      runGraph: runGraphMock,
    };

    await runOpsAgent("req-1", deps);

    const priorMessages = runGraphMock.mock.calls[0][5];
    expect(priorMessages).toEqual([]);

    // Thread-awareness guard should NOT be in system prompt
    const passedPrompt = runGraphMock.mock.calls[0][2] as string;
    expect(passedPrompt).not.toContain("Prior messages in this thread are context only");
  });

  it("injects getThreadHistory via deps", async () => {
    const getThreadHistoryMock = vi.fn().mockResolvedValue([]);

    const deps: RunOpsAgentDeps = {
      getRequest: vi.fn().mockResolvedValue(makeRequest()),
      transitionRequest: vi.fn().mockImplementation(
        async (_id: string, _from: string[], to: string, patch?: Record<string, unknown>) => ({
          ...makeRequest(),
          status: to,
          ...patch,
        }),
      ),
      expireStale: vi.fn(),
      postMessage: vi.fn(),
      createOpsTools: vi.fn().mockReturnValue([]),
      createAgentModel: vi.fn().mockResolvedValue(fakeModel()),
      getThreadHistory: getThreadHistoryMock,
      runGraph: vi.fn().mockResolvedValue({
        kind: "answer",
        text: "ok",
        modelCalls: 1,
        toolLog: [],
        promptTokens: 0,
        completionTokens: 0,
      }),
    };

    await runOpsAgent("req-1", deps);

    expect(getThreadHistoryMock).toHaveBeenCalledWith("C_OPS", "1234.5678", "req-1");
  });
});

// ---------------------------------------------------------------------------
// formatThreadHistory
// ---------------------------------------------------------------------------

describe("formatThreadHistory", () => {
  function makeRow(overrides: Partial<OpsRequestRow> = {}): OpsRequestRow {
    return { ...makeRequest(), ...overrides } as OpsRequestRow;
  }

  it("produces user/assistant pair for answered text", () => {
    const row = makeRow({
      status: "answered" as const,
      text: "how is the system",
      result: { text: "All systems healthy.", toolCalls: [], modelCalls: 1 },
    });

    const messages = formatThreadHistory([row]);
    expect(messages).toEqual([
      { role: "user", content: "how is the system" },
      { role: "assistant", content: "All systems healthy." },
    ]);
  });

  it("produces pair for answered routine", () => {
    const row = makeRow({
      status: "answered" as const,
      text: "investigate brand images",
      result: {
        description: "Investigate brand images",
        sessionUrl: "https://claude.ai/code/session/abc",
        toolCalls: [],
        modelCalls: 1,
      },
    });

    const messages = formatThreadHistory([row]);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({ role: "user", content: "investigate brand images" });
    // No result.text — falls through to description
    expect(messages[1].content).toContain("Investigate brand images");
  });

  it("produces pair for answered system-bot", () => {
    const row = makeRow({
      status: "answered" as const,
      text: "repair request payload",
      result: {
        sessionUrl: "https://claude.ai/code/session/repair-1",
        modelCalls: 0,
      },
    });

    const messages = formatThreadHistory([row]);
    expect(messages).toHaveLength(2);
    // No result.text, no description — falls through to sessionUrl
    expect(messages[1].content).toContain("https://claude.ai/code/session/repair-1");
  });

  it("produces pair for executed", () => {
    const row = makeRow({
      status: "executed" as const,
      text: "refresh brand test-brand",
      proposal: { kind: "refresh_brand", slug: "test-brand" },
      result: { toolCalls: [], modelCalls: 1 },
    });

    const messages = formatThreadHistory([row]);
    expect(messages).toHaveLength(2);
    expect(messages[1].content).toContain("Refresh brand: test-brand");
    expect(messages[1].content).toMatch(/executed/i);
  });

  it("produces pair for awaiting_confirm", () => {
    const row = makeRow({
      status: "awaiting_confirm" as const,
      text: "refresh brand test-brand",
      proposal: { kind: "refresh_brand", slug: "test-brand" },
      result: { toolCalls: [], modelCalls: 1 },
    });

    const messages = formatThreadHistory([row]);
    expect(messages).toHaveLength(2);
    expect(messages[1].content).toContain("Refresh brand: test-brand");
    expect(messages[1].content).toMatch(/confirmation/i);
  });

  it("produces pair for cancelled", () => {
    const row = makeRow({
      status: "cancelled" as const,
      text: "refresh brand test-brand",
      proposal: { kind: "refresh_brand", slug: "test-brand" },
      result: { toolCalls: [], modelCalls: 1 },
    });

    const messages = formatThreadHistory([row]);
    expect(messages).toHaveLength(2);
    expect(messages[1].content).toContain("Refresh brand: test-brand");
    expect(messages[1].content).toMatch(/cancelled/);
  });

  it("produces pair for expired", () => {
    const row = makeRow({
      status: "expired" as const,
      text: "refresh brand test-brand",
      proposal: { kind: "refresh_brand", slug: "test-brand" },
      result: { toolCalls: [], modelCalls: 1 },
    });

    const messages = formatThreadHistory([row]);
    expect(messages).toHaveLength(2);
    expect(messages[1].content).toContain("Refresh brand: test-brand");
    expect(messages[1].content).toMatch(/expired/);
  });

  it("produces pair for refused", () => {
    const row = makeRow({
      status: "refused" as const,
      text: "do something dangerous",
      result: { reason: "Action not permitted", toolCalls: [], modelCalls: 1 },
    });

    const messages = formatThreadHistory([row]);
    expect(messages).toHaveLength(2);
    expect(messages[1].content).toContain("Action not permitted");
  });

  it("produces pair for failed", () => {
    const row = makeRow({
      status: "failed" as const,
      text: "check something",
      result: { error: "timeout exceeded", toolCalls: [], modelCalls: 1 },
    });

    const messages = formatThreadHistory([row]);
    expect(messages).toHaveLength(2);
    expect(messages[1].content).toMatch(/Failed/);
  });

  it("reads tool names from result.toolCalls not row.toolCalls", () => {
    const row = makeRow({
      status: "answered" as const,
      text: "check brand status",
      toolCalls: [],  // row-level toolCalls is empty
      result: {
        text: "Brand looks good.",
        toolCalls: [{ name: "brand_context", ms: 80, bytes: 200 }],
        modelCalls: 1,
      },
    });

    const messages = formatThreadHistory([row]);
    expect(messages[1].content).toContain("[Used: brand_context]");
  });

  it("handles missing result.toolCalls", () => {
    const row = makeRow({
      status: "answered" as const,
      text: "quick question",
      result: { text: "Quick answer.", modelCalls: 1 },
    });

    const messages = formatThreadHistory([row]);
    expect(messages[1].content).not.toContain("[Used: ]");
    expect(messages[1].content).toBe("Quick answer.");
  });

  it("returns empty array for empty input", () => {
    expect(formatThreadHistory([])).toEqual([]);
  });
});
