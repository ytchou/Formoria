import { describe, expect, it, vi, beforeEach } from "vitest";

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
    expect(deps.postMessage).toHaveBeenCalledOnce();
  });
});
