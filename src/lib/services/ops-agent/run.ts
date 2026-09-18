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
import { dispatchWorkflow as defaultDispatchWorkflow } from "@/lib/adapters/github/actions-api";
import { postMessage as slackPostMessage } from "@/lib/adapters/slack/web-api";
import { renderProposalCard as slackRenderProposalCard } from "@/lib/adapters/slack/blocks";
import { listIssues as defaultListIssues } from "@/lib/adapters/sentry/issues";
import { getBrandBySlug, searchBrandsAutocomplete } from "@/lib/services/brands";
import { listCurationJobs, getCurationJobDetail } from "@/lib/services/curation-jobs";
import { runGraph as defaultRunGraph, type GraphResult } from "./graph";
import { createOpsTools, type OpsTool, type OpsToolDeps, type OpsToolContext } from "./tools";
import { describeProposal, validateProposal } from "./proposals";
import { extractRepairRequest, executeRepairRequest } from "./repair";
import {
  systemStatus as defaultSystemStatus,
  brandContext as defaultBrandContext,
  jobDetail as defaultJobDetail,
  runReadonlyQuery as defaultRunReadonlyQuery,
} from "./readers";
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
    userMessage?: string,
    signal?: AbortSignal,
  ) => Promise<GraphResult>;
  dispatchWorkflow?: (
    file: string,
    inputs?: Record<string, string>,
  ) => Promise<{ ok: true } | { ok: false; status: number }>;
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

  // Wire defaults that need request context (channel, userId, etc.)
  const postMsg =
    deps.postMessage ??
    (async (threadTs: string, text: string) => {
      const res = await slackPostMessage({
        channel: request.channelId,
        threadTs,
        text,
      });
      return res.ok ? res.ts : undefined;
    });

  const renderCard =
    deps.renderProposalCard ??
    ((desc) =>
      slackRenderProposalCard({
        requestId: request.id,
        operatorSlackId: request.slackUserId,
        proposal: desc.action,
        rationale: desc.why,
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      }));

  // 3. Transition received → running
  try {
    await transition(request.id, ["received"], "running");
  } catch (err) {
    console.error("[ops-agent] transition received→running failed:", err);
    await postMsg(
      request.threadTs,
      "Failed to start processing your request. It may already be in progress.",
    ).catch(() => {});
    return { kind: "failed", modelCalls: 0, toolLog: [] };
  }

  // 3b. Repair request detection — system bot only
  const isSystemRequest = request.operatorEmail?.startsWith("system:");
  if (isSystemRequest) {
    const repairRequest = extractRepairRequest(request.text);
    if (repairRequest) {
      try {
        const dispatch = deps.dispatchWorkflow ?? defaultDispatchWorkflow;
        const repairResult = await executeRepairRequest(
          repairRequest,
          { dispatchWorkflow: dispatch },
          {
            requestId: request.id,
            channelId: request.channelId,
            threadTs: request.threadTs,
          },
        );

        const status = repairResult.ok ? "executed" : "failed";
        await transition(request.id, ["running"], status, {
          result: {
            repair: repairResult,
            modelCalls: 0,
          },
        });

        const summary = repairResult.ok
          ? `Dispatched ${repairResult.outcomes.filter((o) => o.ok).length} repair(s).`
          : `Repair failed: ${repairResult.outcomes.filter((o) => !o.ok).map((o) => o.error).join(", ")}`;
        await postMsg(request.threadTs, summary);

        if (repairResult.ok) {
          return { kind: "answer" as const, text: summary, modelCalls: 0, toolLog: [] };
        } else {
          return { kind: "failed" as const, modelCalls: 0, toolLog: [] };
        }
      } catch (err) {
        console.error("[ops-agent] repair processing failed:", err);
        try {
          await transition(request.id, ["running"], "failed");
        } catch {
          // transition itself failed — already logged above
        }
        return { kind: "failed" as const, modelCalls: 0, toolLog: [] };
      }
    }

    // System bot sent something that isn't a valid RepairRequest — refuse
    await transition(request.id, ["running"], "refused", {
      result: {
        reason: "Invalid or missing RepairRequest from system bot",
        modelCalls: 0,
      },
    });
    await postMsg(
      request.threadTs,
      "Received a system message but could not parse a valid repair request.",
    );
    return { kind: "refused" as const, reason: "invalid_repair_request", modelCalls: 0, toolLog: [] };
  }

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
    systemStatus:
      deps.toolDeps?.systemStatus ??
      (() => defaultSystemStatus({ listCurationJobs })),
    brandContext:
      deps.toolDeps?.brandContext ??
      ((query) =>
        defaultBrandContext(query, {
          searchBrandsAutocomplete,
          getBrandBySlug,
        })),
    jobDetail:
      deps.toolDeps?.jobDetail ??
      ((jobId) => defaultJobDetail(jobId, { getCurationJobDetail })),
    runReadonlyQuery:
      deps.toolDeps?.runReadonlyQuery ?? defaultRunReadonlyQuery,
    // PostHog adapter not yet implemented — stub returns an error so the
    // model receives a clear signal instead of silently empty data.
    queryPosthog:
      deps.toolDeps?.queryPosthog ??
      (async () => ({ error: "PostHog query adapter not yet implemented" })),
    listErrors: deps.toolDeps?.listErrors ?? defaultListIssues,
  };

  const toolCtx: OpsToolContext = {
    // onProposed is a no-op at this layer; the graph captures the proposal
    // in its own closed-over state and returns it as `kind: "proposal"`.
    onProposed: () => {},
    validateProposal: (proposal) => validateProposal(proposal, { getBrandBySlug }),
  };

  const tools = buildTools(toolDeps, toolCtx);

  // 7. Invoke graph
  const abortSignal = AbortSignal.timeout(60_000);
  let result: GraphResult;

  try {
    result = await invokeGraph(model, tools, systemPrompt, request.text, abortSignal);
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
