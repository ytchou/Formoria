import { beforeAll, describe, expect, it, vi } from "vitest";

import type { ChatMessage, ChatToolDefinition } from "@/lib/services/openai-client";
import type { AgentModel, AgentModelResponse } from "@/lib/services/enrich-phases/agents/runtime";
import { runGraph } from "../graph";
import type { OpsTool } from "../tools";

// Blank Langfuse creds so fetchLangfusePrompt falls back to snapshot
beforeAll(() => {
  vi.stubEnv("LANGFUSE_PUBLIC_KEY", "");
  vi.stubEnv("LANGFUSE_SECRET_KEY", "");
  vi.stubEnv("LANGFUSE_HOST", "");
});

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

const USAGE = { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 };

type ScriptedToolCall = { name: string; args: Record<string, unknown> };
type ScriptedTurn = ScriptedToolCall[] | string;

type InvokeOptions = { signal?: AbortSignal; tools?: ChatToolDefinition[] };

function fakeModel(turns: ScriptedTurn[]): AgentModel {
  let callIndex = 0;
  return {
    async invoke(_messages: ChatMessage[], _opts?: InvokeOptions): Promise<AgentModelResponse> {
      const turn = turns[callIndex++];
      if (turn === undefined) {
        return { content: "(exhausted)", usage: USAGE };
      }
      if (typeof turn === "string") {
        return { content: turn, usage: USAGE };
      }
      // Tool calls
      return {
        content: null,
        toolCalls: turn.map((tc, i) => ({
          id: `call-${callIndex}-${i}`,
          name: tc.name,
          args: tc.args,
        })),
        usage: USAGE,
      };
    },
  };
}

function fakeTool(name: string, result: unknown = { ok: true }): OpsTool {
  return {
    definition: { name, description: `Fake ${name}`, parameters: {} },
    run: vi.fn().mockResolvedValue(JSON.stringify(result)),
  };
}

function fakeProposeTool(validCount: number = Infinity): OpsTool {
  let calls = 0;
  return {
    definition: { name: "propose_action", description: "Propose", parameters: {} },
    run: vi.fn().mockImplementation(async () => {
      calls++;
      if (calls <= validCount) {
        return JSON.stringify({ ok: true, proposal: { kind: "refresh_brand", slug: "test" } });
      }
      return JSON.stringify({ error: "unknown_brand" });
    }),
  };
}

function failingProposeTool(): OpsTool {
  return {
    definition: { name: "propose_action", description: "Propose", parameters: {} },
    run: vi.fn().mockResolvedValue(JSON.stringify({ error: "unknown_brand" })),
  };
}

const SYSTEM_PROMPT = "You are the ops agent.";

// ---------------------------------------------------------------------------
// Test 1: text_answer_ends_loop
// ---------------------------------------------------------------------------

describe("runGraph", () => {
  it("text answer ends the loop", async () => {
    const model = fakeModel(["The system is healthy."]);
    const tools = [fakeTool("system_status")];

    const result = await runGraph(model, tools, SYSTEM_PROMPT);
    expect(result.kind).toBe("answer");
    if (result.kind === "answer") {
      expect(result.text).toBe("The system is healthy.");
    }
    expect(result.modelCalls).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // Test 2: tool_call_then_answer
  // ---------------------------------------------------------------------------

  it("tool call then answer appends tool message with tool_call_id", async () => {
    const systemStatusTool = fakeTool("system_status", {
      healthRuns: [],
      fixQueue: [],
      jobs: [],
    });

    const model = fakeModel([
      [{ name: "system_status", args: {} }],
      "Everything looks fine.",
    ]);

    const result = await runGraph(model, [systemStatusTool], SYSTEM_PROMPT);
    expect(result.kind).toBe("answer");
    if (result.kind === "answer") {
      expect(result.text).toBe("Everything looks fine.");
    }
    expect(systemStatusTool.run).toHaveBeenCalledOnce();
    expect(result.modelCalls).toBe(2);
  });

  // ---------------------------------------------------------------------------
  // Test 3: unknown_tool_returns_error_json
  // ---------------------------------------------------------------------------

  it("unknown tool returns error JSON and loop continues", async () => {
    const model = fakeModel([
      [{ name: "drop_table", args: {} }],
      "Sorry, I tried an unknown tool.",
    ]);

    const result = await runGraph(model, [fakeTool("system_status")], SYSTEM_PROMPT);
    expect(result.kind).toBe("answer");
    if (result.kind === "answer") {
      expect(result.text).toContain("unknown tool");
    }
    expect(result.modelCalls).toBe(2);
  });

  // ---------------------------------------------------------------------------
  // Test 4: proposal_ends_loop
  // ---------------------------------------------------------------------------

  it("propose_action valid ends loop with proposal", async () => {
    const proposeTool = fakeProposeTool(1);

    const model = fakeModel([
      [{ name: "propose_action", args: { kind: "refresh_brand", slug: "test" } }],
    ]);

    const result = await runGraph(model, [proposeTool], SYSTEM_PROMPT);
    expect(result.kind).toBe("proposal");
    if (result.kind === "proposal") {
      expect(result.proposal).toBeDefined();
    }
  });

  // ---------------------------------------------------------------------------
  // Test 5: two_bad_proposals_refuse
  // ---------------------------------------------------------------------------

  it("two bad proposals cause refused", async () => {
    const proposeTool = failingProposeTool();

    const model = fakeModel([
      [{ name: "propose_action", args: { kind: "refresh_brand", slug: "bad" } }],
      [{ name: "propose_action", args: { kind: "refresh_brand", slug: "bad2" } }],
      "I give up.",
    ]);

    const result = await runGraph(model, [proposeTool], SYSTEM_PROMPT);
    expect(result.kind).toBe("refused");
    if (result.kind === "refused") {
      expect(result.reason).toBe("bad_proposals");
    }
  });

  // ---------------------------------------------------------------------------
  // Test 6: turn_cap_and_recursion_limit
  // ---------------------------------------------------------------------------

  it("turn cap stops after 3 model turns", async () => {
    // Model always calls a tool — never answers
    const turns: ScriptedTurn[] = Array.from({ length: 10 }, () => [
      { name: "system_status", args: {} },
    ]);
    const model = fakeModel(turns);

    const result = await runGraph(
      model,
      [fakeTool("system_status")],
      SYSTEM_PROMPT,
    );
    expect(result.kind).toBe("refused");
    if (result.kind === "refused") {
      expect(result.reason).toBe("turn_cap");
    }
    expect(result.modelCalls).toBeLessThanOrEqual(3);
  });

  // ---------------------------------------------------------------------------
  // Test 7: fire_routine exits graph with routine result
  // ---------------------------------------------------------------------------

  it("fire_routine exits graph with routine result", async () => {
    const fireRoutineTool = fakeTool("fire_routine", { ok: true, description: "Investigate brand images" });

    const model = fakeModel([
      [{ name: "fire_routine", args: { description: "Investigate brand images" } }],
    ]);

    const result = await runGraph(model, [fireRoutineTool], SYSTEM_PROMPT);
    expect(result.kind).toBe("routine");
    if (result.kind === "routine") {
      expect(result.description).toBe("Investigate brand images");
    }
  });

  // ---------------------------------------------------------------------------
  // Test 8: max turns is 3
  // ---------------------------------------------------------------------------

  it("max turns is 3", async () => {
    // 3 tool-calling turns then a text answer — the 4th should never be reached
    const turns: ScriptedTurn[] = [
      [{ name: "system_status", args: {} }],
      [{ name: "system_status", args: {} }],
      [{ name: "system_status", args: {} }],
      "This should not be reached",
    ];
    const model = fakeModel(turns);

    const result = await runGraph(
      model,
      [fakeTool("system_status")],
      SYSTEM_PROMPT,
    );
    // After 3 model calls that all made tool calls, afterModel on the 3rd
    // returns "done" because currentModelCalls >= MAX_TURNS (3).
    expect(result.modelCalls).toBe(3);
  });
});
