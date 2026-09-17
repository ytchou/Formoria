import { z } from "zod";

// ---------------------------------------------------------------------------
// Proposal discriminated union
// ---------------------------------------------------------------------------

const ALLOWED_WORKFLOWS = ["e2e-staging"] as const;

const RefreshBrand = z.object({
  kind: z.literal("refresh_brand"),
  slug: z.string().min(1),
});

const RerunJob = z.object({
  kind: z.literal("rerun_job"),
  jobId: z.string().min(1),
  mode: z.enum(["rerun", "resume"]),
});

const DispatchWorkflow = z.object({
  kind: z.literal("dispatch_workflow"),
  workflow: z.enum(ALLOWED_WORKFLOWS),
  mode: z.literal("preflight"),
});

const CodeFix = z.object({
  kind: z.literal("code_fix"),
  instruction: z.string().min(10).max(2000),
});

export const OpsProposalSchema = z.discriminatedUnion("kind", [
  RefreshBrand,
  RerunJob,
  DispatchWorkflow,
  CodeFix,
]);

export type OpsProposal = z.infer<typeof OpsProposalSchema>;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type ValidateProposalDeps = {
  getBrandBySlug?: (slug: string) => Promise<unknown>;
};

type ValidationResult = { ok: true } | { ok: false; error: string };

export async function validateProposal(
  proposal: OpsProposal,
  deps: ValidateProposalDeps,
): Promise<ValidationResult> {
  switch (proposal.kind) {
    case "refresh_brand": {
      if (!deps.getBrandBySlug) return { ok: false, error: "unknown_brand" };
      try {
        await deps.getBrandBySlug(proposal.slug);
        return { ok: true };
      } catch {
        return { ok: false, error: "unknown_brand" };
      }
    }

    case "dispatch_workflow": {
      if (!(ALLOWED_WORKFLOWS as readonly string[]).includes(proposal.workflow)) {
        return { ok: false, error: "invalid_workflow" };
      }
      return { ok: true };
    }

    case "code_fix": {
      if (proposal.instruction.length < 10 || proposal.instruction.length > 2000) {
        return { ok: false, error: "invalid_instruction" };
      }
      return { ok: true };
    }

    case "rerun_job":
      return { ok: true };
  }
}

// ---------------------------------------------------------------------------
// Description for proposal card
// ---------------------------------------------------------------------------

export type ProposalDescription = {
  action: string;
  steps: string;
  why: string;
  cost: string;
};

export function describeProposal(proposal: OpsProposal): ProposalDescription {
  switch (proposal.kind) {
    case "refresh_brand":
      return {
        action: `Refresh brand: ${proposal.slug}`,
        steps: "1. Create a curation job targeting the brand\n2. Re-run enrichment phases",
        why: "Brand data may be stale or incomplete",
        cost: "1 curation job (~2-5 API calls)",
      };

    case "rerun_job":
      return {
        action: `${proposal.mode === "rerun" ? "Rerun" : "Resume"} job: ${proposal.jobId}`,
        steps: `1. ${proposal.mode === "rerun" ? "Create a fresh job copying the original targets" : "Resume the existing job from where it stopped"}`,
        why: "Job needs to be re-executed",
        cost: "1 curation job (variable API calls)",
      };

    case "dispatch_workflow":
      return {
        action: `Dispatch workflow: ${proposal.workflow}`,
        steps: `1. Trigger ${proposal.workflow} in ${proposal.mode} mode`,
        why: `${proposal.workflow} workflow requested`,
        cost: "1 workflow run",
      };

    case "code_fix":
      return {
        action: "Propose code fix",
        steps: "1. Create a draft PR with the proposed changes\n2. Await human review",
        why: proposal.instruction.slice(0, 200),
        cost: "1 draft PR",
      };
  }
}
