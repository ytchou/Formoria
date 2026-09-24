import { after, NextResponse } from "next/server";
import { withAuditScope } from "@/lib/audit/scope";
import { verifySlackSignature } from "@/lib/adapters/slack/signature";
import { postMessage, updateMessage } from "@/lib/adapters/slack/web-api";
import { renderResultCard } from "@/lib/adapters/slack/blocks";
import {
  getRequest,
  transitionRequest,
} from "@/lib/services/ops-agent/requests";
import {
  executeProposal,
  type ExecuteContext,
  type ExecuteDeps,
} from "@/lib/services/ops-agent/execute";
import {
  clearDispatch,
  findInFlightDispatch,
  markDispatchStale,
  recordDispatch,
  STALE_CHECK_MS,
} from "@/lib/services/ops-agent/dispatches";
import { describeProposal } from "@/lib/services/ops-agent/proposals";
import type { OpsProposal } from "@/lib/services/ops-agent/proposals";
import { requestBrandRefreshesBySlugs } from "@/lib/services/submissions";
import {
  enqueueAdminCurationJob,
  enqueueCurationRecovery,
} from "@/lib/services/curation-jobs";
import { dispatchCurationJob } from "@/lib/services/curation-dispatch";
import { runE2eAgentNow } from "@/lib/adapters/railway/api";

export const runtime = "nodejs";

const defaultExecuteDeps: ExecuteDeps = {
  requestBrandRefreshesBySlugs,
  enqueueAdminCurationJob,
  dispatchCurationJob,
  enqueueCurationRecovery,
  dispatchWorkflow: runE2eAgentNow,
  findInFlightDispatch: () => findInFlightDispatch(),
  recordDispatch: (requestId) => recordDispatch(requestId),
  clearDispatch: (requestId) => clearDispatch(requestId),
};

const STALE_DISPATCH_TEXT =
  "The e2e run didn't start within 5 minutes. A scheduled run was probably active. Ask again in a few minutes.";

export type InteractionsRouteDeps = {
  verifySignature: typeof verifySlackSignature;
  updateMessage: typeof updateMessage;
  renderResultCard: typeof renderResultCard;
  getRequest: typeof getRequest;
  transitionRequest: typeof transitionRequest;
  executeProposal: typeof executeProposal;
  describeProposal: typeof describeProposal;
  executeDeps?: ExecuteDeps;
  scheduleAfter: (fn: () => Promise<void>) => void;
  sleep: (ms: number) => Promise<void>;
  markDispatchStale: (id: string) => Promise<boolean>;
  postMessage: typeof postMessage;
  env: Record<string, string | undefined>;
};

const defaultDeps: InteractionsRouteDeps = {
  verifySignature: verifySlackSignature,
  updateMessage,
  renderResultCard,
  getRequest,
  transitionRequest,
  executeProposal,
  describeProposal,
  executeDeps: defaultExecuteDeps,
  scheduleAfter: (fn) => after(fn),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  markDispatchStale: (id) => markDispatchStale(id),
  postMessage,
  env: process.env as Record<string, string | undefined>,
};

export function createInteractionsHandler(
  deps: InteractionsRouteDeps = defaultDeps,
) {
  return withAuditScope(async (request: Request) => {
    const rawBody = await request.text();

    const timestamp = request.headers.get("x-slack-request-timestamp") ?? "";
    const signature = request.headers.get("x-slack-signature") ?? "";
    const secret = deps.env.SLACK_SIGNING_SECRET ?? "";

    if (!secret) {
      return NextResponse.json({ error: "Signing secret not configured" }, { status: 401 });
    }

    if (!deps.verifySignature({ rawBody, timestamp, signature, secret })) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const params = new URLSearchParams(rawBody);
    const payloadStr = params.get("payload");
    if (!payloadStr) {
      return NextResponse.json({ error: "Missing payload" }, { status: 400 });
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(payloadStr) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    const actions = payload.actions as Array<{
      action_id: string;
      value: string;
    }>;
    const action = actions?.[0];
    if (!action) {
      return NextResponse.json({});
    }

    const actionId = action.action_id;
    const requestId = action.value;
    const userId = (payload.user as Record<string, string>)?.id;
    const channelId = (payload.channel as Record<string, string>)?.id;
    const messageTs = (payload.message as Record<string, string>)?.ts;

    const row = await deps.getRequest(requestId);
    if (!row) {
      if (channelId && messageTs) {
        deps.scheduleAfter(async () => {
          await deps.updateMessage({
            channel: channelId,
            ts: messageTs,
            text: "Unknown request.",
          });
        });
      }
      return NextResponse.json({});
    }

    if (userId !== row.slackUserId) {
      if (channelId && messageTs) {
        deps.scheduleAfter(async () => {
          await deps.updateMessage({
            channel: channelId,
            ts: messageTs,
            text: "Only the requester who initiated this action can confirm or cancel.",
          });
        });
      }
      return NextResponse.json({});
    }

    if (row.expiresAt && new Date(row.expiresAt) < new Date()) {
      await deps.transitionRequest(row.id, ["awaiting_confirm"], "expired", {
        result: { reason: "expired" },
      });
      if (channelId && messageTs) {
        deps.scheduleAfter(async () => {
          await deps.updateMessage({
            channel: channelId,
            ts: messageTs,
            text: "This action has expired.",
          });
        });
      }
      return NextResponse.json({});
    }

    if (row.status !== "awaiting_confirm") {
      if (channelId && messageTs) {
        deps.scheduleAfter(async () => {
          await deps.updateMessage({
            channel: channelId,
            ts: messageTs,
            text: `This request is no longer awaiting confirmation (status: ${row.status}).`,
          });
        });
      }
      return NextResponse.json({});
    }

    if (actionId === "ops_cancel") {
      await deps.transitionRequest(row.id, ["awaiting_confirm"], "cancelled", {
        result: { reason: "cancelled_by_operator" },
      });
      if (channelId && messageTs) {
        deps.scheduleAfter(async () => {
          await deps.updateMessage({
            channel: channelId,
            ts: messageTs,
            text: "Action cancelled.",
          });
        });
      }
      return NextResponse.json({});
    }

    if (actionId === "ops_confirm") {
      await deps.transitionRequest(row.id, ["awaiting_confirm"], "running", {
        result: { reason: "confirmed_by_operator" },
      });

      deps.scheduleAfter(async () => {
        if (channelId && messageTs) {
          await deps
            .updateMessage({
              channel: channelId,
              ts: messageTs,
              text: "Working on it…",
            })
            .catch(() => {});
        }

        const proposal = row.proposal as OpsProposal;
        const ctx: ExecuteContext = {
          operatorEmail: row.operatorEmail ?? "",
          requestId: row.id,
          channel: row.channelId,
          threadTs: row.threadTs,
        };
        const resolvedExecuteDeps = deps.executeDeps ?? defaultExecuteDeps;

        try {
          const execResult = await deps.executeProposal(
            proposal,
            ctx,
            resolvedExecuteDeps,
          );

          if (execResult.ok) {
            await deps.transitionRequest(row.id, ["running"], "executed", {
              result: execResult.result,
            });
            if (channelId && messageTs) {
              const desc = deps.describeProposal(proposal);
              const summary = execResult.result.summary;
              const blocks = deps.renderResultCard(
                typeof summary === "string"
                  ? { proposal: desc.action, summary }
                  : { proposal: desc.action, result: JSON.stringify(execResult.result) },
              );
              await deps
                .updateMessage({
                  channel: channelId,
                  ts: messageTs,
                  text: "Action executed successfully.",
                  blocks,
                })
                .catch(() => {});
            }
            if (proposal.kind === "dispatch_workflow") {
              // In-process timer; relies on the long-lived Railway Node process
              // surviving STALE_CHECK_MS. A redeploy inside that window drops the
              // check (the lease still expires). Move to a scheduled job if that
              // loss becomes visible.
              deps.scheduleAfter(async () => {
                await deps.sleep(STALE_CHECK_MS);
                const stale = await deps.markDispatchStale(row.id);
                if (stale) {
                  await deps.postMessage({
                    channel: row.channelId,
                    threadTs: row.threadTs,
                    text: STALE_DISPATCH_TEXT,
                  });
                }
              });
            }
          } else {
            await deps.transitionRequest(row.id, ["running"], "failed", {
              result: { error: execResult.error },
            });
            if (channelId && messageTs) {
              const desc = deps.describeProposal(proposal);
              const blocks = deps.renderResultCard({
                proposal: desc.action,
                error: execResult.error,
              });
              await deps
                .updateMessage({
                  channel: channelId,
                  ts: messageTs,
                  text: `Action failed: ${execResult.error}`,
                  blocks,
                })
                .catch(() => {});
            }
          }
        } catch (err) {
          await deps
            .transitionRequest(row.id, ["running"], "failed", {
              result: {
                error: err instanceof Error ? err.message : String(err),
              },
            })
            .catch(() => {});
        }
      });

      return NextResponse.json({});
    }

    return NextResponse.json({});
  });
}

export const POST = createInteractionsHandler();
