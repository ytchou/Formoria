import { auditedCall } from "@/lib/audit";
import type { CurationRecoveryInput, CurationRecoveryCounts } from "../curation-jobs";
import type { OpsProposal } from "./proposals";
import type { OpsCodeFixInput, OpsCodeFixResult } from "./code-fix";

// Accept OpsProposal or compatible shapes. The `mode` field on
// dispatch_workflow is enforced by the proposal Zod schema but not
// read by any execute function, so we keep it optional here for
// backward compatibility with callers that omit it.
type ExecutableProposal =
  | Extract<OpsProposal, { kind: "refresh_brand" }>
  | Extract<OpsProposal, { kind: "rerun_job" }>
  | { kind: "dispatch_workflow"; workflow: string; mode?: string }
  | Extract<OpsProposal, { kind: "code_fix" }>;

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
  ) => Promise<Array<{ slug: string; submissionId: string | null; error: string | null }>>;
  enqueueAdminCurationJob: (input: {
    params: { target: "submissions" | "brands"; submissionIds: string[] };
    dryRun: boolean;
    startedBy: string;
  }) => Promise<{ id: string }>;
  dispatchCurationJob: (jobId: string) => Promise<unknown>;
  enqueueCurationRecovery: (input: CurationRecoveryInput) => Promise<{ job: { id: string }; counts: CurationRecoveryCounts }>;
  dispatchWorkflow: (
    workflowFile: string,
    inputs: Record<string, string>,
  ) => Promise<unknown>;
  runCodeFix: (input: OpsCodeFixInput) => Promise<OpsCodeFixResult>;
};

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export type ExecuteResult =
  | { ok: true; result: Record<string, unknown> }
  | { ok: false; error: string };

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
    result: { jobId: job.id, adminUrl: `/admin/jobs/${job.id}`, counts },
  };
}

// ---------------------------------------------------------------------------
// Dispatch: dispatch_workflow
// ---------------------------------------------------------------------------

const ALLOWED_WORKFLOWS: Record<string, Record<string, string>> = {
  "e2e-staging": {},
};

async function executeDispatchWorkflow(
  proposal: Extract<ExecutableProposal, { kind: "dispatch_workflow" }>,
  _ctx: ExecuteContext,
  deps: ExecuteDeps,
): Promise<ExecuteResult> {
  const inputs = ALLOWED_WORKFLOWS[proposal.workflow];
  if (inputs === undefined) {
    return { ok: false, error: "not_allowed" };
  }

  await deps.dispatchWorkflow(`${proposal.workflow}.yml`, inputs);
  return { ok: true, result: { dispatched: proposal.workflow } };
}

// ---------------------------------------------------------------------------
// Dispatch: code_fix
// ---------------------------------------------------------------------------

async function executeCodeFix(
  proposal: Extract<OpsProposal, { kind: "code_fix" }>,
  ctx: ExecuteContext,
  deps: ExecuteDeps,
): Promise<ExecuteResult> {
  const result = await deps.runCodeFix({
    instruction: proposal.instruction,
    requestId: ctx.requestId,
  });
  if (!result.ok) return result;
  return {
    ok: true,
    result: { prUrl: result.prUrl, prNumber: result.prNumber },
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
          case "code_fix":
            return executeCodeFix(proposal, ctx, deps);
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
