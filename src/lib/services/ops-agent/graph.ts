/**
 * Ops agent graph — a bounded tool loop that reads operational data and
 * optionally proposes one mutating action.
 *
 * Two nodes: `model` (invokes the LLM) and `tools` (dispatches tool calls).
 * Exits: text answer, valid proposal, refusal (bad proposals or turn cap),
 * or failure (signal abort / unexpected error).
 *
 * No `interrupt()`, no checkpointer.
 */

import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type { ChatMessage } from "@/lib/services/openai-client";
import type { AgentModel } from "@/lib/services/enrich-phases/agents/runtime";
import type { OpsTool } from "./tools";
import type { OpsProposal } from "./proposals";

// ---------------------------------------------------------------------------
// Caps
// ---------------------------------------------------------------------------

export const MAX_TURNS = 6;
const MAX_BAD_PROPOSALS = 2;
const RECURSION_LIMIT = 14;
const WALL_CLOCK_MS = 60_000;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

type ToolLogEntry = { name: string; ms: number; bytes: number };

const OpsGraphState = Annotation.Root({
  messages: Annotation<ChatMessage[]>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),
  toolLog: Annotation<ToolLogEntry[]>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),
  proposal: Annotation<OpsProposal | undefined>({
    reducer: (_prev, next) => next,
    default: () => undefined,
  }),
  rationale: Annotation<string | undefined>({
    reducer: (_prev, next) => next,
    default: () => undefined,
  }),
  badSubmits: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),
  modelCalls: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),
  lastAssistantText: Annotation<string | undefined>({
    reducer: (_prev, next) => next,
    default: () => undefined,
  }),
});

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export type GraphResult =
  | { kind: "answer"; text: string; modelCalls: number; toolLog: ToolLogEntry[] }
  | {
      kind: "proposal";
      proposal: OpsProposal;
      rationale: string;
      modelCalls: number;
      toolLog: ToolLogEntry[];
    }
  | { kind: "refused"; reason: string; modelCalls: number; toolLog: ToolLogEntry[] }
  | { kind: "failed"; modelCalls: number; toolLog: ToolLogEntry[] };

// ---------------------------------------------------------------------------
// runGraph
// ---------------------------------------------------------------------------

export async function runGraph(
  model: AgentModel,
  tools: OpsTool[],
  systemPrompt: string,
  userMessage?: string,
  signal?: AbortSignal,
): Promise<GraphResult> {
  const toolMap = new Map(tools.map((t) => [t.definition.name, t]));
  const toolDefs = tools.map((t) => t.definition);

  // Track mutable state across nodes (closed over, not in graph state)
  let currentProposal: OpsProposal | undefined;
  let currentRationale: string | undefined;
  let currentBadSubmits = 0;
  let currentModelCalls = 0;
  const currentToolLog: ToolLogEntry[] = [];

  // Model node
  async function modelNode(
    state: typeof OpsGraphState.State,
  ): Promise<Partial<typeof OpsGraphState.State>> {
    currentModelCalls++;

    const response = await model.invoke(state.messages, {
      tools: toolDefs,
      signal,
    });

    const newMessages: ChatMessage[] = [];
    let lastAssistantText: string | undefined;

    if (response.toolCalls && response.toolCalls.length > 0) {
      newMessages.push({
        role: "assistant" as const,
        content: response.content,
        tool_calls: response.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.args),
          },
        })),
      });
    } else {
      const text = response.content ?? "";
      newMessages.push({
        role: "assistant" as const,
        content: text,
      });
      lastAssistantText = text;
    }

    return {
      messages: newMessages,
      modelCalls: currentModelCalls,
      lastAssistantText,
    };
  }

  // Tools node
  async function toolsNode(
    state: typeof OpsGraphState.State,
  ): Promise<Partial<typeof OpsGraphState.State>> {
    const lastMessage = state.messages[state.messages.length - 1];
    if (
      !lastMessage ||
      lastMessage.role !== "assistant" ||
      !("tool_calls" in lastMessage) ||
      !lastMessage.tool_calls
    ) {
      return {};
    }

    const newMessages: ChatMessage[] = [];
    const newToolLog: ToolLogEntry[] = [];

    for (const toolCall of lastMessage.tool_calls) {
      const toolName = toolCall.function.name;
      const tool = toolMap.get(toolName);

      let result: string;
      if (!tool) {
        result = JSON.stringify({ error: "unknown_tool" });
      } else {
        let args: unknown;
        try {
          args = JSON.parse(toolCall.function.arguments);
        } catch {
          args = {};
        }

        const start = Date.now();
        result = await tool.run(args);
        const ms = Date.now() - start;
        newToolLog.push({ name: toolName, ms, bytes: result.length });

        // Check for proposal result
        if (toolName === "propose_action") {
          try {
            const parsed = JSON.parse(result);
            if (parsed.ok) {
              // onProposed was called by the tool — extract proposal from args
              currentProposal = args as OpsProposal;
              const assistantMsg = state.messages[state.messages.length - 1];
              currentRationale =
                assistantMsg?.role === "assistant"
                  ? (typeof assistantMsg.content === "string"
                      ? assistantMsg.content
                      : "")
                  : "";
            } else if (parsed.error) {
              currentBadSubmits++;
            }
          } catch {
            currentBadSubmits++;
          }
        }
      }

      newMessages.push({
        role: "tool" as const,
        content: result,
        tool_call_id: toolCall.id,
      });
    }

    currentToolLog.push(...newToolLog);

    return {
      messages: newMessages,
      toolLog: newToolLog,
      badSubmits: currentBadSubmits,
    };
  }

  // Router after model node
  function afterModel(
    state: typeof OpsGraphState.State,
  ): string {
    if (currentModelCalls >= MAX_TURNS) return "done";

    const lastMessage = state.messages[state.messages.length - 1];
    if (
      !lastMessage ||
      lastMessage.role !== "assistant" ||
      !("tool_calls" in lastMessage) ||
      !lastMessage.tool_calls ||
      lastMessage.tool_calls.length === 0
    ) {
      return "done";
    }

    return "tools";
  }

  // Router after tools node
  function afterTools(): string {
    if (currentProposal) return "done";
    if (currentBadSubmits >= MAX_BAD_PROPOSALS) return "done";
    return "model";
  }

  // Build graph
  const graph = new StateGraph(OpsGraphState)
    .addNode("model", modelNode)
    .addNode("tools", toolsNode)
    .addEdge(START, "model")
    .addConditionalEdges("model", afterModel, {
      tools: "tools",
      done: END,
    })
    .addConditionalEdges("tools", afterTools, {
      model: "model",
      done: END,
    })
    .compile();

  // Run
  const abortSignal = signal ?? AbortSignal.timeout(WALL_CLOCK_MS);

  let finalState: typeof OpsGraphState.State | undefined;

  try {
    const initialMessages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
    ];
    if (userMessage) {
      initialMessages.push({ role: "user", content: userMessage });
    }

    finalState = await graph.invoke(
      { messages: initialMessages },
      { recursionLimit: RECURSION_LIMIT, signal: abortSignal },
    ) as typeof OpsGraphState.State;
  } catch (err) {
    if (abortSignal.aborted) {
      return { kind: "failed", modelCalls: currentModelCalls, toolLog: currentToolLog };
    }
    if (
      err instanceof Error &&
      err.constructor.name === "GraphRecursionError"
    ) {
      return { kind: "refused", reason: "turn_cap", modelCalls: currentModelCalls, toolLog: currentToolLog };
    }
    return { kind: "failed", modelCalls: currentModelCalls, toolLog: currentToolLog };
  }

  // Determine result from closed-over state
  if (currentProposal) {
    return {
      kind: "proposal",
      proposal: currentProposal,
      rationale: currentRationale ?? "",
      modelCalls: currentModelCalls,
      toolLog: currentToolLog,
    };
  }

  if (currentBadSubmits >= MAX_BAD_PROPOSALS) {
    return { kind: "refused", reason: "bad_proposals", modelCalls: currentModelCalls, toolLog: currentToolLog };
  }

  if (currentModelCalls >= MAX_TURNS) {
    return { kind: "refused", reason: "turn_cap", modelCalls: currentModelCalls, toolLog: currentToolLog };
  }

  // Text answer: extract from final state
  const lastText = finalState?.lastAssistantText;
  if (lastText !== undefined) {
    return { kind: "answer", text: lastText, modelCalls: currentModelCalls, toolLog: currentToolLog };
  }

  // Fallback: find last assistant message
  if (finalState?.messages) {
    for (let i = finalState.messages.length - 1; i >= 0; i--) {
      const msg = finalState.messages[i];
      if (msg?.role === "assistant" && typeof msg.content === "string") {
        return { kind: "answer", text: msg.content, modelCalls: currentModelCalls, toolLog: currentToolLog };
      }
    }
  }

  return { kind: "failed", modelCalls: currentModelCalls, toolLog: currentToolLog };
}
