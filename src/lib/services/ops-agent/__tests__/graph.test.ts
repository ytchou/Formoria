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

  it("turn cap stops after 25 model turns", async () => {
    // Model always calls a tool — never answers
    const turns: ScriptedTurn[] = Array.from({ length: 30 }, (_, i) => [
      { name: "system_status", args: { i } },
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
    expect(result.modelCalls).toBeLessThanOrEqual(25);
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

  it("max turns is 25", async () => {
    // 25 tool-calling turns with unique args, then a text answer — the 26th should never be reached
    const turns: ScriptedTurn[] = [
      ...Array.from({ length: 25 }, (_, i) => [
        { name: "system_status", args: { i } },
      ] as ScriptedTurn),
      "This should not be reached",
    ];
    const model = fakeModel(turns as ScriptedTurn[]);

    const result = await runGraph(
      model,
      [fakeTool("system_status")],
      SYSTEM_PROMPT,
    );
    // After 25 model calls that all made tool calls, afterModel on the 25th
    // returns "done" because currentModelCalls >= MAX_TURNS (25).
    expect(result.modelCalls).toBe(25);
  });

  // ---------------------------------------------------------------------------
  // Test 9: no-progress detection exits on 3 consecutive identical steps
  // ---------------------------------------------------------------------------

  it("no-progress detection exits on 3 consecutive identical tool steps", async () => {
    // 3 identical tool calls → no_progress after the 3rd
    const turns: ScriptedTurn[] = Array.from({ length: 5 }, () => [
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
      expect(result.reason).toBe("no_progress");
    }
    expect(result.modelCalls).toBe(3);
  });

  // ---------------------------------------------------------------------------
  // Test 10: no-progress does not fire when args differ
  // ---------------------------------------------------------------------------

  it("no-progress does not fire when tool args differ each step", async () => {
    // Each step has different args — no repeat detection
    const turns: ScriptedTurn[] = [
      [{ name: "system_status", args: { query: "a" } }],
      [{ name: "system_status", args: { query: "b" } }],
      [{ name: "system_status", args: { query: "c" } }],
      "Done investigating.",
    ];
    const model = fakeModel(turns);

    const result = await runGraph(
      model,
      [fakeTool("system_status")],
      SYSTEM_PROMPT,
    );
    expect(result.kind).toBe("answer");
    if (result.kind === "answer") {
      expect(result.text).toBe("Done investigating.");
    }
  });

  // ---------------------------------------------------------------------------
  // Thread history (priorMessages)
  // ---------------------------------------------------------------------------

  it("includes priorMessages in initial messages", async () => {
    const capturedMessages: ChatMessage[][] = [];
    const model: AgentModel = {
      async invoke(messages: ChatMessage[]): Promise<AgentModelResponse> {
        capturedMessages.push([...messages]);
        return { content: "Got context.", usage: USAGE };
      },
    };

    const priorMessages: ChatMessage[] = [
      { role: "user", content: "what is brand X" },
      { role: "assistant", content: "Brand X is a snack brand." },
    ];

    const result = await runGraph(model, [], SYSTEM_PROMPT, "follow up question", undefined, priorMessages);
    expect(result.kind).toBe("answer");

    // First model call should have [system, prior user, prior assistant, user]
    const msgs = capturedMessages[0];
    expect(msgs).toHaveLength(4);
    expect(msgs[0]).toEqual({ role: "system", content: SYSTEM_PROMPT });
    expect(msgs[1]).toEqual({ role: "user", content: "what is brand X" });
    expect(msgs[2]).toEqual({ role: "assistant", content: "Brand X is a snack brand." });
    expect(msgs[3]).toEqual({ role: "user", content: "follow up question" });
  });

  it("works without priorMessages (backward compatible)", async () => {
    const capturedMessages: ChatMessage[][] = [];
    const model: AgentModel = {
      async invoke(messages: ChatMessage[]): Promise<AgentModelResponse> {
        capturedMessages.push([...messages]);
        return { content: "Direct answer.", usage: USAGE };
      },
    };

    const result = await runGraph(model, [], SYSTEM_PROMPT, "hello");
    expect(result.kind).toBe("answer");

    const msgs = capturedMessages[0];
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toEqual({ role: "system", content: SYSTEM_PROMPT });
    expect(msgs[1]).toEqual({ role: "user", content: "hello" });
  });
});
