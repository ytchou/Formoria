import { publish, type PublishResult } from "@/lib/adapters/github/app-publish";
import { getInstallationToken } from "@/lib/adapters/github/app-auth";
import {
  createRepoWorkerClient,
  type RepoWorkerClient,
} from "@/lib/services/health-agent/repo-worker-client";

const CODE_FIX_DEADLINE_MS = 1_500_000;
const EDITABLE_FILES = ["**/*"];
const BLOCKED_FILES = [".github/**", "supabase/migrations/**"];

const CODE_FIX_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: {
      type: "string",
      enum: ["changed", "no_changes", "needs_human"],
    },
    summary: { type: "string" },
    changedFiles: { type: "array", items: { type: "string" } },
    verification: { type: "array", items: { type: "string" } },
  },
  required: ["status", "summary", "changedFiles", "verification"],
} as const;

export type OpsCodeFixInput = {
  instruction: string;
  requestId: string;
};

export type OpsCodeFixResult =
  | { ok: true; prUrl: string; prNumber: number }
  | { ok: false; error: string };

export type OpsCodeFixDeps = {
  createClient?: () => RepoWorkerClient;
  publish?: typeof publish;
};

function createDefaultClient(): RepoWorkerClient {
  const baseUrl = process.env.REPO_WORKER_URL;
  if (!baseUrl) throw new Error("REPO_WORKER_URL is not configured");

  return createRepoWorkerClient(
    {
      baseUrl,
      token: process.env.REPO_WORKER_TOKEN,
      getCloneToken: () => getInstallationToken("clone"),
    },
    { deadlineMs: CODE_FIX_DEADLINE_MS, pollIntervalMs: 5_000 },
  );
}

function buildPrompt(instruction: string): string {
  return `You are implementing a small, operator-approved fix in the Formoria repository.

Read AGENTS.md and CLAUDE.md before editing. Apply the smallest correct change for the instruction below.

Hard constraints:
- Do not edit .github/** or supabase/migrations/**.
- Do not commit, push, open a pull request, or access external providers.
- Do not add or expose credentials, .env files, or secrets.
- Do not delete tests or add skipped tests.
- Run lint and only the tests relevant to files you changed.
- If the instruction is ambiguous or requires a broad refactor, make no changes and return needs_human.
- Return only JSON matching the supplied schema.

Operator instruction:
<instruction>
${instruction}
</instruction>`;
}

function titleFromInstruction(instruction: string): string {
  const normalized = instruction.replace(/\s+/g, " ").trim();
  const summary = normalized.length > 100
    ? `${normalized.slice(0, 97)}...`
    : normalized;
  return `fix(ops-agent): ${summary}`;
}

function branchFromRequestId(requestId: string): string {
  const safeId = requestId.replace(/[^a-zA-Z0-9._-]/g, "-");
  if (!safeId) throw new Error("Ops request ID is invalid");
  return `ops-agent/${safeId}`;
}

function publishError(result: PublishResult): string {
  return result.ok ? "" : `GitHub publication failed (${result.error.status})`;
}

export async function runOpsCodeFix(
  input: OpsCodeFixInput,
  deps: OpsCodeFixDeps = {},
): Promise<OpsCodeFixResult> {
  const client = (deps.createClient ?? createDefaultClient)();
  const result = await client.run({
    ref: "staging",
    commands: [],
    editableFiles: EDITABLE_FILES,
    blockedFiles: BLOCKED_FILES,
    agent: {
      prompt: buildPrompt(input.instruction),
      access: "write",
      jsonSchema: CODE_FIX_SCHEMA,
    },
  });

  if (result.status !== "done") {
    return { ok: false, error: result.error ?? "Repository worker failed" };
  }
  if (result.revertedFiles?.length) {
    return {
      ok: false,
      error: `Fix attempted changes outside policy: ${result.revertedFiles.join(", ")}`,
    };
  }

  const output = result.agent?.structuredOutput as
    | { status?: string; summary?: string }
    | undefined;
  const files = result.changedFiles ?? [];
  if (output?.status !== "changed" || files.length === 0 || !result.baseSha) {
    return {
      ok: false,
      error: output?.summary ?? "Codex produced no publishable changes",
    };
  }

  const title = titleFromInstruction(input.instruction);
  const publishResult = await (deps.publish ?? publish)({
    baseSha: result.baseSha,
    files,
    branch: branchFromRequestId(input.requestId),
    title,
    body: [
      "## Ops Agent Code Fix",
      "",
      `**Request ID:** \`${input.requestId}\``,
      "",
      "**Instruction:**",
      "```",
      input.instruction,
      "```",
      "",
      output.summary ?? "Implemented by the Formoria Ops Agent through the Railway repo-worker.",
      "",
      "> Draft PR created by the Formoria Ops Agent. Review before merging.",
    ].join("\n"),
    labels: ["ops-agent"],
    allowedPaths: [""],
    blockedPaths: [".github/", "supabase/migrations/"],
    draft: true,
  });

  if (!publishResult.ok) {
    return { ok: false, error: publishError(publishResult) };
  }
  if ("dryRun" in publishResult) {
    return { ok: false, error: "Code-fix publication unexpectedly ran in dry-run mode" };
  }

  return {
    ok: true,
    prUrl: publishResult.prUrl,
    prNumber: publishResult.prNumber,
  };
}
