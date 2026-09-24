import { auditedCall } from "@/lib/audit";
import type { CurationRecoveryInput, CurationRecoveryCounts } from "../curation-jobs";
import type { OpsProposal } from "./proposals";
import type { OpsDispatch } from "./types";
import { threadLink } from "./dispatches";
import { getSiteUrl } from "@/lib/site-url";
import { escapeSlackMrkdwn } from "../health-agent/report";

// Accept OpsProposal or compatible shapes. The `mode` field on
// dispatch_workflow is enforced by the proposal Zod schema but not
// read by any execute function, so we keep it optional here for
// backward compatibility with callers that omit it.
type ExecutableProposal =
  | Extract<OpsProposal, { kind: "refresh_brand" }>
  | Extract<OpsProposal, { kind: "rerun_job" }>
  | { kind: "dispatch_workflow"; workflow: string; mode?: string };

// ---------------------------------------------------------------------------
// Context & Dependencies
// ---------------------------------------------------------------------------

export type ExecuteContext = {
  operatorEmail: string;
  requestId: string;
  channel: string;
  threadTs: string;
};

export type ExecuteDeps = {
  requestBrandRefreshesBySlugs: (
    slugs: string[],
    requesterEmail: string,
  ) => Promise<Array<{ slug: string; name: string; submissionId: string | null; error: string | null }>>;
  enqueueAdminCurationJob: (input: {
    params: { target: "submissions" | "brands"; submissionIds: string[] };
    dryRun: boolean;
    startedBy: string;
  }) => Promise<{ id: string }>;
  dispatchCurationJob: (jobId: string) => Promise<unknown>;
  enqueueCurationRecovery: (input: CurationRecoveryInput) => Promise<{ job: { id: string }; counts: CurationRecoveryCounts }>;
  dispatchWorkflow: () => Promise<{ ok: true } | { ok: false; error: string }>;
  findInFlightDispatch: () => Promise<OpsDispatch | null>;
  recordDispatch: (requestId: string) => Promise<void>;
  clearDispatch: (requestId: string) => Promise<void>;
};

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export type ExecuteResult =
  | { ok: true; result: Record<string, unknown> }
  | { ok: false; error: string };

/** Slack mrkdwn link to the job's admin page; Slack needs an absolute URL. */
function adminJobLink(jobId: string): string {
  return `<${getSiteUrl()}/admin/jobs/${jobId}|${jobId}>`;
}

// ---------------------------------------------------------------------------
// Dispatch: refresh_brand
// ---------------------------------------------------------------------------

async function executeRefreshBrand(
  proposal: Extract<OpsProposal, { kind: "refresh_brand" }>,
  ctx: ExecuteContext,
  deps: ExecuteDeps,
): Promise<ExecuteResult> {
  const outcomes = await deps.requestBrandRefreshesBySlugs(
    [proposal.slug],
    ctx.operatorEmail,
  );

  const outcome = outcomes[0];
  if (!outcome || outcome.submissionId === null) {
    return { ok: false, error: outcome?.error ?? "no_outcome" };
  }

  const submissionId = outcome.submissionId;

  const job = await deps.enqueueAdminCurationJob({
    params: { target: "submissions", submissionIds: [submissionId] },
    dryRun: false,
    startedBy: ctx.operatorEmail,
  });

  await deps.dispatchCurationJob(job.id);

  return {
    ok: true,
    result: {
      submissionId,
      jobId: job.id,
      adminUrl: `/admin/jobs/${job.id}`,
      summary: `Refresh started for ${escapeSlackMrkdwn(outcome.name)} — job ${adminJobLink(job.id)}`,
    },
  };
}

// ---------------------------------------------------------------------------
// Dispatch: rerun_job
// ---------------------------------------------------------------------------

async function executeRerunJob(
  proposal: Extract<OpsProposal, { kind: "rerun_job" }>,
  ctx: ExecuteContext,
  deps: ExecuteDeps,
): Promise<ExecuteResult> {
  const { job, counts } = await deps.enqueueCurationRecovery({
    sourceJobId: proposal.jobId,
    startedBy: ctx.operatorEmail,
    action: { kind: proposal.mode },
  });
  await deps.dispatchCurationJob(job.id);
  return {
    ok: true,
    result: {
      jobId: job.id,
      adminUrl: `/admin/jobs/${job.id}`,
      counts,
      summary: `${proposal.mode === "resume" ? "Resuming" : "Re-running"} job ${proposal.jobId}: ${counts.total} targets — ${adminJobLink(job.id)}`,
    },
  };
}

// ---------------------------------------------------------------------------
// Dispatch: dispatch_workflow
// ---------------------------------------------------------------------------

const ALLOWED_WORKFLOWS = new Set(["e2e-staging"]);

const DISPATCH_STARTED_SUMMARY =
  "Started e2e run on staging (~20 min). Updates will post in this thread.";

async function executeDispatchWorkflow(
  proposal: Extract<ExecutableProposal, { kind: "dispatch_workflow" }>,
  ctx: ExecuteContext,
  deps: ExecuteDeps,
): Promise<ExecuteResult> {
  if (!ALLOWED_WORKFLOWS.has(proposal.workflow)) {
    return { ok: false, error: "not_allowed" };
  }

  // Check-then-record is not atomic; two Confirms in the same instant can both
  // pass. Acceptable for a single-operator bot; move to a conditional update
  // or unique partial index if concurrent operators appear.
  const inFlight = await deps.findInFlightDispatch();
  if (inFlight) {
    return {
      ok: false,
      error: `An e2e run is already in progress — ${threadLink(inFlight.channelId, inFlight.threadTs)}`,
    };
  }

  // Record before Run-now so the staging agent always finds a row to claim.
  await deps.recordDispatch(ctx.requestId);

  // A failed clear must never mask the Run-now failure; the pending lease
  // expires on its own after PENDING_LEASE_MS.
  const clearSafely = async () => {
    try {
      await deps.clearDispatch(ctx.requestId);
    } catch (clearError) {
      console.error("[ops-agent] clearDispatch failed:", clearError);
    }
  };

  let outcome: Awaited<ReturnType<ExecuteDeps["dispatchWorkflow"]>>;
  try {
    outcome = await deps.dispatchWorkflow();
  } catch (error) {
    await clearSafely();
    throw error;
  }
  if (!outcome.ok) {
    await clearSafely();
    return { ok: false, error: outcome.error };
  }
  return {
    ok: true,
    result: { dispatched: proposal.workflow, summary: DISPATCH_STARTED_SUMMARY },
  };
}

// ---------------------------------------------------------------------------
// Main dispatcher
// ---------------------------------------------------------------------------

export async function executeProposal(
  proposal: ExecutableProposal,
  ctx: ExecuteContext,
  deps: ExecuteDeps,
): Promise<ExecuteResult> {
  try {
    return await auditedCall(
      { provider: "ops-agent", operation: "executeProposal", kind: "service", meta: { proposalKind: proposal.kind } },
      async () => {
        switch (proposal.kind) {
          case "refresh_brand":
            return executeRefreshBrand(proposal, ctx, deps);
          case "rerun_job":
            return executeRerunJob(proposal, ctx, deps);
          case "dispatch_workflow":
            return executeDispatchWorkflow(proposal, ctx, deps);
          default:
            return { ok: false, error: `unsupported_proposal_kind` };
        }
      },
    );
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
