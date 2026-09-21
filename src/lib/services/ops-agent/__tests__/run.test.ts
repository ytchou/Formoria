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

import { runOpsAgent, type RunOpsAgentDeps } from "../run";
import type { GraphResult } from "../graph";

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
      runGraph: vi.fn().mockResolvedValue(graphResult),
    };

    const result = await runOpsAgent("req-1", deps);
    expect(result.kind).toBe("failed");
    // Should not throw
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

    // Posts reasoning + session URL
    const repairMsg = (deps.postMessage as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && c[1].includes("repair-1"),
    );
    expect(repairMsg).toBeDefined();
    expect(repairMsg![1]).toContain("Repair from health: unused export");
    expect(repairMsg![1]).toContain("https://claude.ai/code/session/repair-1");

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

  it("human_with_valid_repair_json_uses_llm_path", async () => {
    const graphResult: GraphResult = {
      kind: "answer",
      text: "I see that repair request.",
      modelCalls: 1,
      toolLog: [],
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
      runGraph: vi.fn().mockResolvedValue(graphResult),
    };

    const result = await runOpsAgent("req-1", deps);

    // runGraph IS called — human operators always use the LLM path
    expect(deps.runGraph).toHaveBeenCalledOnce();

    expect(result.kind).toBe("answer");
  });
});
