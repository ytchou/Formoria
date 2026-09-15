/**
 * Ops agent orchestrator — loads the request, builds the model and tools,
 * invokes the graph, and persists the outcome.
 *
 * Never imports `next/server`.
 */

import { fetchLangfusePromptWithMeta } from "@/lib/langfuse/prompt";
import {
  createAgentModel as defaultCreateAgentModel,
  type AgentModel,
} from "@/lib/services/enrich-phases/agents/runtime";
import type { LlmAuditContext } from "@/lib/services/llm-audit";
import { runGraph as defaultRunGraph, type GraphResult } from "./graph";
import { createOpsTools, type OpsTool, type OpsToolDeps, type OpsToolContext } from "./tools";
import { describeProposal, validateProposal } from "./proposals";
import {
  expireStale as defaultExpireStale,
  getRequest as defaultGetRequest,
  transitionRequest as defaultTransitionRequest,
} from "./requests";
import type { OpsRequestRow, OpsRequestStatus } from "./types";

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export type RunOpsAgentDeps = {
  getRequest?: (id: string) => Promise<OpsRequestRow | null>;
  transitionRequest?: (
    id: string,
    from: OpsRequestStatus[],
    to: OpsRequestStatus,
    patch?: {
      result?: unknown;
      proposal?: unknown;
      expiresAt?: string | null;
      cardTs?: string | null;
    },
  ) => Promise<OpsRequestRow>;
  expireStale?: () => Promise<void>;
  postMessage?: (threadTs: string, text: string) => Promise<string | undefined>;
  renderProposalCard?: (desc: ReturnType<typeof describeProposal>) => unknown[];
  createOpsTools?: (deps: OpsToolDeps, ctx: OpsToolContext) => ReturnType<typeof createOpsTools>;
  createAgentModel?: (
    profileKey: string,
    audit: LlmAuditContext,
  ) => Promise<AgentModel>;
  runGraph?: (
    model: AgentModel,
    tools: OpsTool[],
    systemPrompt: string,
    signal?: AbortSignal,
  ) => Promise<GraphResult>;
  toolDeps?: Partial<OpsToolDeps>;
};

// ---------------------------------------------------------------------------
// runOpsAgent
// ---------------------------------------------------------------------------

export async function runOpsAgent(
  requestId: string,
  deps: RunOpsAgentDeps = {},
): Promise<GraphResult> {
  const getReq = deps.getRequest ?? defaultGetRequest;
  const transition = deps.transitionRequest ?? defaultTransitionRequest;
  const expire = deps.expireStale ?? defaultExpireStale;
  const postMsg = deps.postMessage ?? (async () => undefined);
  const renderCard = deps.renderProposalCard ?? (() => []);
  const buildTools = deps.createOpsTools ?? createOpsTools;
  const buildModel = deps.createAgentModel ?? defaultCreateAgentModel;
  const invokeGraph = deps.runGraph ?? defaultRunGraph;

  // 1. Expire stale requests
  await expire();

  // 2. Load request
  const request = await getReq(requestId);
  if (!request) {
    return { kind: "failed", modelCalls: 0, toolLog: [] };
  }

  // 3. Transition received → running
  await transition(request.id, ["received"], "running");

  // 4. Fetch prompt
  // The string literal 'ops-agent-system' is the call site for the prompts test
  const { text: systemPrompt, prompt: promptMeta } =
    await fetchLangfusePromptWithMeta("ops-agent-system");

  // 5. Create model
  const model = await buildModel("opsAgent", {
    phase: "opsAgent",
    prompt: promptMeta,
  });

  // 6. Build tools
  const toolDeps: OpsToolDeps = {
    systemStatus: async () => ({}),
    brandContext: async () => ({}),
    jobDetail: async () => ({}),
    runReadonlyQuery: async () => [],
    queryPosthog: async () => ({}),
    listErrors: async () => [],
    ...deps.toolDeps,
  };

  const toolCtx: OpsToolContext = {
    // onProposed is a no-op at this layer; the graph captures the proposal
    // in its own closed-over state and returns it as `kind: "proposal"`.
    onProposed: () => {},
    validateProposal: (proposal) => validateProposal(proposal, {}),
  };

  const tools = buildTools(toolDeps, toolCtx);

  // 7. Invoke graph
  const abortSignal = AbortSignal.timeout(60_000);
  let result: GraphResult;

  try {
    result = await invokeGraph(model, tools, systemPrompt, abortSignal);
  } catch {
    result = { kind: "failed", modelCalls: 0, toolLog: [] };
  }

  // 8. Post-process based on result kind
  const toolCallsSummary = result.toolLog;
  const modelCallsCount = result.modelCalls;

  try {
    switch (result.kind) {
      case "answer": {
        await transition(request.id, ["running"], "answered", {
          result: {
            text: result.text,
            toolCalls: toolCallsSummary,
            modelCalls: modelCallsCount,
          },
        });
        await postMsg(request.threadTs, result.text);
        break;
      }

      case "proposal": {
        const desc = describeProposal(result.proposal);
        const cardBlocks = renderCard(desc);
        const rationale = result.rationale;

        const cardMessage = [
          rationale,
          "", // blank line
          `*${desc.action}*`,
          desc.why,
        ]
          .filter(Boolean)
          .join("\n");

        const cardTs = await postMsg(request.threadTs, cardMessage);

        const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();

        await transition(request.id, ["running"], "awaiting_confirm", {
          proposal: result.proposal,
          expiresAt,
          cardTs: cardTs ?? null,
          result: {
            card: cardBlocks,
            toolCalls: toolCallsSummary,
            modelCalls: modelCallsCount,
          },
        });
        break;
      }

      case "refused": {
        await transition(request.id, ["running"], "refused", {
          result: {
            reason: result.reason,
            toolCalls: toolCallsSummary,
            modelCalls: modelCallsCount,
          },
        });
        await postMsg(
          request.threadTs,
          `I could not complete this request: ${result.reason}`,
        );
        break;
      }

      case "failed": {
        await transition(request.id, ["running"], "failed", {
          result: {
            toolCalls: toolCallsSummary,
            modelCalls: modelCallsCount,
          },
        });
        await postMsg(
          request.threadTs,
          "Something went wrong while processing your request. Please try again.",
        );
        break;
      }
    }
  } catch (err) {
    // Transition or Slack post failed — log but don't re-throw
    console.error("[ops-agent] post-processing failed:", err);
  }

  return result;
}
