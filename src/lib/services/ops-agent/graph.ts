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

import { createHash } from "node:crypto";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type { ChatMessage } from "@/lib/services/openai-client";
import type { AgentModel } from "@/lib/services/enrich-phases/agents/runtime";
import type { OpsTool } from "./tools";
import type { OpsProposal } from "./proposals";

// ---------------------------------------------------------------------------
// Caps
// ---------------------------------------------------------------------------

const MAX_TURNS = 25;
const MAX_BAD_PROPOSALS = 2;
const MAX_CONSECUTIVE_REPEATS = 3;
const RECURSION_LIMIT = 52;
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

type GraphResultBase = {
  modelCalls: number;
  toolLog: ToolLogEntry[];
  promptTokens: number;
  completionTokens: number;
};

export type GraphResult =
  | (GraphResultBase & { kind: "answer"; text: string })
  | (GraphResultBase & { kind: "proposal"; proposal: OpsProposal; rationale: string })
  | (GraphResultBase & { kind: "routine"; description: string; lastAssistantText: string })
  | (GraphResultBase & { kind: "refused"; reason: string })
  | (GraphResultBase & { kind: "failed"; reason?: "timeout" | "error" });

// ---------------------------------------------------------------------------
// runGraph
// ---------------------------------------------------------------------------

export async function runGraph(
  model: AgentModel,
  tools: OpsTool[],
  systemPrompt: string,
  userMessage?: string,
  signal?: AbortSignal,
  priorMessages?: ChatMessage[],
): Promise<GraphResult> {
  const toolMap = new Map(tools.map((t) => [t.definition.name, t]));
  const toolDefs = tools.map((t) => t.definition);

  // Track mutable state across nodes (closed over, not in graph state)
  let currentProposal: OpsProposal | undefined;
  let currentRationale: string | undefined;
  let currentRoutineDescription: string | undefined;
  let currentBadSubmits = 0;
  let currentModelCalls = 0;
  let currentPromptTokens = 0;
  let currentCompletionTokens = 0;
  let previousStepHash = "";
  let consecutiveRepeatCount = 0;
  let noProgress = false;
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

    currentPromptTokens += response.usage?.prompt_tokens ?? 0;
    currentCompletionTokens += response.usage?.completion_tokens ?? 0;

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

        // Check for fire_routine result
        if (toolName === "fire_routine") {
          try {
            const parsed = JSON.parse(result);
            if (!parsed.error) {
              const desc = (args as { description?: string })?.description ?? "";
              currentRoutineDescription = desc;
            }
          } catch {
            // ignore parse errors
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

    // No-progress detection: hash all tool calls in this step
    const stepParts = lastMessage.tool_calls.map((tc) => {
      const args = JSON.parse(tc.function.arguments);
      const sortedArgs = JSON.stringify(args, Object.keys(args).sort());
      const idx = newMessages.findIndex((m) => m.role === "tool" && "tool_call_id" in m && m.tool_call_id === tc.id);
      const result = idx >= 0 && typeof newMessages[idx].content === "string"
        ? (newMessages[idx].content as string).slice(0, 2000)
        : "";
      return JSON.stringify({ tool: tc.function.name, args: sortedArgs, result });
    });
    const stepHash = createHash("sha256").update(stepParts.join("|")).digest("hex");

    if (stepHash === previousStepHash) {
      consecutiveRepeatCount++;
    } else {
      consecutiveRepeatCount = 1;
    }
    previousStepHash = stepHash;

    if (consecutiveRepeatCount >= MAX_CONSECUTIVE_REPEATS) {
      noProgress = true;
    }

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
    if (currentRoutineDescription !== undefined) return "done";
    if (currentProposal) return "done";
    if (currentBadSubmits >= MAX_BAD_PROPOSALS) return "done";
    if (noProgress) return "done";
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
      ...(priorMessages ?? []),
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
      return { kind: "failed", reason: "timeout", modelCalls: currentModelCalls, toolLog: currentToolLog, promptTokens: currentPromptTokens, completionTokens: currentCompletionTokens };
    }
    if (
      err instanceof Error &&
      err.constructor.name === "GraphRecursionError"
    ) {
      return { kind: "refused", reason: "turn_cap", modelCalls: currentModelCalls, toolLog: currentToolLog, promptTokens: currentPromptTokens, completionTokens: currentCompletionTokens };
    }
    return { kind: "failed", reason: "error", modelCalls: currentModelCalls, toolLog: currentToolLog, promptTokens: currentPromptTokens, completionTokens: currentCompletionTokens };
  }

  // Determine result from closed-over state
  if (currentRoutineDescription !== undefined) {
    return {
      kind: "routine",
      description: currentRoutineDescription,
      lastAssistantText: finalState?.lastAssistantText ?? "",
      modelCalls: currentModelCalls,
      toolLog: currentToolLog,
      promptTokens: currentPromptTokens,
      completionTokens: currentCompletionTokens,
    };
  }

  if (currentProposal) {
    return {
      kind: "proposal",
      proposal: currentProposal,
      rationale: currentRationale ?? "",
      modelCalls: currentModelCalls,
      toolLog: currentToolLog,
      promptTokens: currentPromptTokens,
      completionTokens: currentCompletionTokens,
    };
  }

  if (noProgress) {
    return { kind: "refused", reason: "no_progress", modelCalls: currentModelCalls, toolLog: currentToolLog, promptTokens: currentPromptTokens, completionTokens: currentCompletionTokens };
  }

  if (currentBadSubmits >= MAX_BAD_PROPOSALS) {
    return { kind: "refused", reason: "bad_proposals", modelCalls: currentModelCalls, toolLog: currentToolLog, promptTokens: currentPromptTokens, completionTokens: currentCompletionTokens };
  }

  if (currentModelCalls >= MAX_TURNS) {
    return { kind: "refused", reason: "turn_cap", modelCalls: currentModelCalls, toolLog: currentToolLog, promptTokens: currentPromptTokens, completionTokens: currentCompletionTokens };
  }

  // Text answer: extract from final state
  const lastText = finalState?.lastAssistantText;
  if (lastText !== undefined) {
    return { kind: "answer", text: lastText, modelCalls: currentModelCalls, toolLog: currentToolLog, promptTokens: currentPromptTokens, completionTokens: currentCompletionTokens };
  }

  // Fallback: find last assistant message produced in this run (skip injected priorMessages)
  if (finalState?.messages) {
    // priorMessages were prepended after the system message; new messages start after them
    const priorCount = priorMessages?.length ?? 0;
    // +1 for system message, +1 for user message (if present)
    const newMessageStart = 1 + priorCount + (userMessage ? 1 : 0);
    for (let i = finalState.messages.length - 1; i >= newMessageStart; i--) {
      const msg = finalState.messages[i];
      if (msg?.role === "assistant" && typeof msg.content === "string") {
        return { kind: "answer", text: msg.content, modelCalls: currentModelCalls, toolLog: currentToolLog, promptTokens: currentPromptTokens, completionTokens: currentCompletionTokens };
      }
    }
  }

  return { kind: "failed", modelCalls: currentModelCalls, toolLog: currentToolLog, promptTokens: currentPromptTokens, completionTokens: currentCompletionTokens };
}
