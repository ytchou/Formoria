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
import { postMessage as slackPostMessage, toSlackMrkdwn } from "@/lib/adapters/slack/web-api";
import { renderProposalCard as slackRenderProposalCard } from "@/lib/adapters/slack/blocks";
import { listIssues as defaultListIssues } from "@/lib/adapters/sentry/issues";
import { getBrandBySlug, searchBrandsAutocomplete } from "@/lib/services/brands";
import { listCurationJobs, getCurationJobDetail } from "@/lib/services/curation-jobs";
import { runGraph as defaultRunGraph, type GraphResult } from "./graph";
import { createOpsTools, type OpsTool, type OpsToolDeps, type OpsToolContext } from "./tools";
import { describeProposal, validateProposal } from "./proposals";
import { fireRoutine as defaultFireRoutine } from "@/lib/adapters/anthropic/routines";
import { extractRepairRequest } from "./repair";
import {
  systemStatus as defaultSystemStatus,
  brandContext as defaultBrandContext,
  jobDetail as defaultJobDetail,
  runReadonlyQuery as defaultRunReadonlyQuery,
} from "./readers";
import {
  expireStale as defaultExpireStale,
  getRequest as defaultGetRequest,
  getThreadHistory as defaultGetThreadHistory,
  transitionRequest as defaultTransitionRequest,
} from "./requests";
import type { ChatMessage } from "@/lib/services/openai-client";
import type { OpsRequestRow, OpsRequestStatus } from "./types";
import type { OpsProposal } from "./proposals";

type SlackBlock = Record<string, unknown>;

// gpt-4o-mini pricing (USD per 1M tokens)
const INPUT_PRICE_PER_M = 0.15;
const OUTPUT_PRICE_PER_M = 0.60;

function estimateCostUsd(promptTokens: number, completionTokens: number): number {
  return (promptTokens * INPUT_PRICE_PER_M + completionTokens * OUTPUT_PRICE_PER_M) / 1_000_000;
}

function formatToolChain(
  toolLog: { name: string }[],
  modelCalls: number,
  costUsd: number,
): string {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const entry of toolLog) {
    if (!seen.has(entry.name)) {
      seen.add(entry.name);
      unique.push(entry.name);
    }
  }
  const turnLabel = modelCalls === 1 ? "1 turn" : `${modelCalls} turns`;
  const costLabel = costUsd > 0 ? `, $${costUsd.toFixed(3)}` : "";
  const meta = `(${turnLabel}${costLabel})`;
  if (unique.length === 0) return meta;
  return `${unique.join(" → ")} ${meta}`;
}

// ---------------------------------------------------------------------------
// Thread history formatter
// ---------------------------------------------------------------------------

export function formatThreadHistory(rows: OpsRequestRow[]): ChatMessage[] {
  const messages: ChatMessage[] = [];

  for (const row of rows) {
    const resultObj = row.result as Record<string, unknown> | null;

    const toolCalls = Array.isArray(resultObj?.toolCalls)
      ? (resultObj!.toolCalls as { name: string }[]).map((t) => t.name).filter(Boolean)
      : [];

    const toolPrefix = toolCalls.length > 0 ? `[Used: ${toolCalls.join(", ")}] ` : "";

    let summary: string | null = null;

    switch (row.status) {
      case "answered": {
        const text =
          (resultObj?.text as string | undefined) ??
          (resultObj?.description as string | undefined) ??
          (resultObj?.sessionUrl as string | undefined) ??
          "(no response)";
        summary = text;
        break;
      }

      case "executed": {
        const action = describeProposal(row.proposal as OpsProposal).action;
        summary = `${action} — executed`;
        break;
      }

      case "awaiting_confirm": {
        const action = describeProposal(row.proposal as OpsProposal).action;
        summary = `${action} — awaiting confirmation`;
        break;
      }

      case "cancelled": {
        const action = describeProposal(row.proposal as OpsProposal).action;
        summary = `${action} — Cancelled`;
        break;
      }

      case "expired": {
        const action = describeProposal(row.proposal as OpsProposal).action;
        summary = `${action} — Expired`;
        break;
      }

      case "refused": {
        summary = (resultObj?.reason as string | undefined) ?? "(refused)";
        break;
      }

      case "failed": {
        const error = (resultObj?.error as string | undefined) ?? "processing error";
        summary = `Failed: ${error}`;
        break;
      }

      default:
        // Unrecognized status — skip
        continue;
    }

    messages.push({ role: "user", content: row.text });
    messages.push({ role: "assistant", content: `${toolPrefix}${summary}` });
  }

  return messages;
}

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
  postMessage?: (
    threadTs: string,
    text: string,
    blocks?: SlackBlock[],
  ) => Promise<string | undefined>;
  renderProposalCard?: (desc: ReturnType<typeof describeProposal>) => SlackBlock[];
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
    priorMessages?: ChatMessage[],
  ) => Promise<GraphResult>;
  fireRoutine?: (params: { routineId: string; text: string }) => Promise<{ sessionUrl: string }>;
  getThreadHistory?: (channelId: string, threadTs: string, excludeId: string) => Promise<OpsRequestRow[]>;
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
  const fireRtn = deps.fireRoutine ?? defaultFireRoutine;
  const getHistory = deps.getThreadHistory ?? defaultGetThreadHistory;

  // 1. Expire stale requests
  await expire();

  // 2. Load request
  const request = await getReq(requestId);
  if (!request) {
    return { kind: "failed", modelCalls: 0, toolLog: [], promptTokens: 0, completionTokens: 0 };
  }

  // Wire defaults that need request context (channel, userId, etc.)
  const postMsg =
    deps.postMessage ??
    (async (threadTs: string, text: string, blocks?: SlackBlock[]) => {
      const res = await slackPostMessage({
        channel: request.channelId,
        threadTs,
        text,
        blocks,
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
    return { kind: "failed", modelCalls: 0, toolLog: [], promptTokens: 0, completionTokens: 0 };
  }

  // 3b. Repair request detection — system bot only
  const isSystemRequest = request.operatorEmail?.startsWith("system:");
  if (isSystemRequest) {
    const repairRequest = extractRepairRequest(request.text);
    if (repairRequest) {
      try {
        const routineId = process.env.OPS_ROUTINE_ID;
        if (!routineId) throw new Error("OPS_ROUTINE_ID is not set");

        const payload = {
          channel: request.channelId,
          thread_ts: request.threadTs,
          operator: request.operatorEmail ?? "system:bot",
          request: request.text,
          repair: repairRequest,
        };
        const { sessionUrl } = await fireRtn({ routineId, text: JSON.stringify(payload) });

        await transition(request.id, ["running"], "answered", {
          result: { sessionUrl, modelCalls: 0 },
        });
        const repairSummary = `Repair from ${repairRequest.agent}: ${repairRequest.findings.map((f) => f.title).join(", ")}`;
        await postMsg(request.threadTs, `${repairSummary}\nWorking on it → ${sessionUrl}`);

        return { kind: "answer" as const, text: `Routine fired: ${sessionUrl}`, modelCalls: 0, toolLog: [], promptTokens: 0, completionTokens: 0 };
      } catch (err) {
        console.error("[ops-agent] repair routine fire failed:", err);
        try {
          await transition(request.id, ["running"], "failed", {
            result: { error: err instanceof Error ? err.message : String(err), modelCalls: 0 },
          });
          await postMsg(request.threadTs, "Failed to start repair routine. Please try again.");
        } catch {
          // transition or Slack post failed — already logged above
        }
        return { kind: "failed" as const, modelCalls: 0, toolLog: [], promptTokens: 0, completionTokens: 0 };
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
    return { kind: "refused" as const, reason: "invalid_repair_request", modelCalls: 0, toolLog: [], promptTokens: 0, completionTokens: 0 };
  }

  // 3c. Load thread history
  const history = await getHistory(request.channelId, request.threadTs, request.id);
  const priorMessages = formatThreadHistory(history);

  // 4. Fetch prompt
  // The string literal 'ops-agent-system' is the call site for the prompts test
  const { text: rawPrompt, prompt: promptMeta } =
    await fetchLangfusePromptWithMeta("ops-agent-system");
  let systemPrompt = `${rawPrompt}\n\nAlways respond in English.`;

  if (priorMessages.length > 0) {
    systemPrompt += "\n\nPrior messages in this thread are context only — do not re-execute past actions unless explicitly asked.";
  }

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
    result = await invokeGraph(model, tools, systemPrompt, request.text, abortSignal, priorMessages);
  } catch {
    result = { kind: "failed", modelCalls: 0, toolLog: [], promptTokens: 0, completionTokens: 0 };
  }

  // 8. Post-process based on result kind
  const toolCallsSummary = result.toolLog;
  const modelCallsCount = result.modelCalls;
  const costUsd = estimateCostUsd(result.promptTokens, result.completionTokens);
  const chain = formatToolChain(toolCallsSummary, modelCallsCount, costUsd);

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
        await postMsg(request.threadTs, `${chain}\n${toSlackMrkdwn(result.text)}`);
        break;
      }

      case "routine": {
        try {
          const routineId = process.env.OPS_ROUTINE_ID;
          if (!routineId) throw new Error("OPS_ROUTINE_ID is not set");

          const payload = {
            channel: request.channelId,
            thread_ts: request.threadTs,
            operator: request.operatorEmail ?? "",
            request: request.text,
            description: result.description,
          };
          const { sessionUrl } = await fireRtn({ routineId, text: JSON.stringify(payload) });

          await transition(request.id, ["running"], "answered", {
            result: {
              sessionUrl,
              description: result.description,
              toolCalls: toolCallsSummary,
              modelCalls: modelCallsCount,
            },
          });
          const routineMsg = result.description
            ? `${chain}\n${result.description}\nWorking on it → ${sessionUrl}`
            : `${chain}\nWorking on it → ${sessionUrl}`;
          await postMsg(request.threadTs, routineMsg);
        } catch (err) {
          console.error("[ops-agent] routine fire failed:", err);
          try {
            await transition(request.id, ["running"], "failed", {
              result: {
                error: err instanceof Error ? err.message : String(err),
                toolCalls: toolCallsSummary,
                modelCalls: modelCallsCount,
              },
            });
            await postMsg(request.threadTs, "Failed to start the routine. Please try again.");
          } catch {
            // transition or Slack post failed — already logged above
          }
        }
        break;
      }

      case "proposal": {
        const desc = describeProposal(result.proposal);
        const cardBlocks = renderCard(desc);
        const rationale = result.rationale;

        const cardMessage = [
          chain,
          rationale,
          "", // blank line
          `*${desc.action}*`,
          desc.why,
        ]
          .filter(Boolean)
          .join("\n");

        const cardTs = await postMsg(request.threadTs, cardMessage, cardBlocks);

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
          `${chain}\nI could not complete this request: ${result.reason}`,
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
          `${chain}\nSomething went wrong while processing your request. Please try again.`,
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
