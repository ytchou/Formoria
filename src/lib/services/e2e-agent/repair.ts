/**
 * Repair node — dispatch scoped writes to repo-worker.
 *
 * Sends the frozen failure set plus diagnosis context to an agent session
 * inside a fresh clone. The session has write tools and scoped `editableFiles`
 * covering e2e specs and application source.
 *
 * Returns a `RepairOutcome` with either the repair result and changed files,
 * or a `needs_human` signal when no changes were produced.
 */

import type {
  DiagnosisResult,
  FrozenFailureSet,
  RepairResult,
} from "@/lib/services/e2e-selfheal/incident";
import type { RepoWorkerClient } from "@/lib/services/health-agent/repo-worker-client";
import type { ChangedFile } from "@/repo-worker/jobs";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REPAIR_DEADLINE_MS = 1_500_000;
const REPAIR_EDITABLE_FILES = ["e2e/**/*.ts", "src/**/*.ts", "src/**/*.tsx"];
const REPAIR_PROMPT_NAME = "e2e-nightly-repair";

const REPAIR_FALLBACK_PROMPT = `You are repairing e2e test failures for the Formoria web application.

Based on the diagnosis, fix the failing tests or the application code. Only edit files
within the allowed editable paths (e2e/**/*.ts, src/**/*.ts, src/**/*.tsx).

Rules:
- Fix the root cause, not symptoms
- Do not delete tests to make them pass
- If a selector changed, update the test selector
- If application behavior changed intentionally, update the test expectation
- Return a JSON object matching the provided schema with your changes`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RepairDeps = {
  createClient: (deadlineMs: number) => RepoWorkerClient;
  failures: FrozenFailureSet;
  diagnosis: DiagnosisResult;
  fetchPrompt: (name: string) => Promise<string>;
  stagingSha: string;
};

export type RepairOutcome = {
  outcome: "repaired" | "needs_human";
  result: RepairResult | null;
  changedFiles: ChangedFile[];
  baseSha: string | undefined;
};

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const REPAIR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    version: { type: "number", const: 1 },
    failureSetHash: { type: "string" },
    addressedFailureIds: { type: "array", items: { type: "string" } },
    addressedRootCauseKeys: { type: "array", items: { type: "string" } },
    changedFiles: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
    remainingWork: { type: "array", items: { type: "string" } },
    complete: { type: "boolean" },
  },
  required: [
    "version",
    "failureSetHash",
    "addressedFailureIds",
    "addressedRootCauseKeys",
    "changedFiles",
    "summary",
    "remainingWork",
    "complete",
  ],
} as const;

// ---------------------------------------------------------------------------
// Node
// ---------------------------------------------------------------------------

/**
 * Dispatch a scoped repair job to the repo-worker.
 *
 * Returns `needs_human` when the agent produces no file changes (the repair
 * could not be automated), or `repaired` with the changed files and base SHA.
 */
export async function repairFailures(deps: RepairDeps): Promise<RepairOutcome> {
  let basePrompt: string;
  try {
    basePrompt = await deps.fetchPrompt(REPAIR_PROMPT_NAME);
  } catch {
    console.log(
      `[e2e-repair] prompt "${REPAIR_PROMPT_NAME}" not found, using inline fallback`,
    );
    basePrompt = REPAIR_FALLBACK_PROMPT;
  }
  const prompt = [
    basePrompt,
    "",
    "## Diagnosis",
    "",
    JSON.stringify(deps.diagnosis, null, 2),
    "",
    "## Frozen failure set",
    "",
    JSON.stringify(deps.failures, null, 2),
  ].join("\n");

  const client = deps.createClient(REPAIR_DEADLINE_MS);

  const result = await client.run({
    ref: deps.stagingSha,
    commands: [],
    editableFiles: REPAIR_EDITABLE_FILES,
    agent: {
      prompt,
      access: "write",
      jsonSchema: REPAIR_SCHEMA,
    },
  });

  const changedFiles = result.changedFiles ?? [];
  const baseSha = result.baseSha;

  if (result.status !== "done" || changedFiles.length === 0) {
    return {
      outcome: "needs_human",
      result: null,
      changedFiles: [],
      baseSha,
    };
  }

  const structured = result.agent?.structuredOutput as RepairResult | undefined;

  return {
    outcome: "repaired",
    result: structured ?? null,
    changedFiles,
    baseSha,
  };
}
