/**
 * Diagnose node — dispatch read-only analysis to repo-worker.
 *
 * Sends the frozen failure set to a Claude Code session inside a fresh clone.
 * The session reads the codebase, classifies each failure, groups them into
 * root-cause clusters, and returns structured `DiagnosisResult`.
 *
 * Read-only: `editableFiles` is empty, no write tools are granted.
 */

import type {
  DiagnosisResult,
  FrozenFailureSet,
} from "@/lib/services/e2e-selfheal/incident";
import type { RepoWorkerClient } from "@/lib/services/health-agent/repo-worker-client";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DIAGNOSE_DEADLINE_MS = 900_000;
const DIAGNOSE_MAX_TURNS = 80;
const DIAGNOSE_ALLOWED_TOOLS = ["Read", "Grep", "Glob", "Bash"];
const DIAGNOSE_PROMPT_NAME = "e2e-nightly-diagnose";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DiagnoseDeps = {
  createClient: (deadlineMs: number) => RepoWorkerClient;
  failures: FrozenFailureSet;
  fetchPrompt: (name: string) => Promise<string>;
  stagingSha: string;
};

export type DiagnoseOutcome = {
  diagnosis: DiagnosisResult;
  aggregate: "noise" | "actionable";
};

// ---------------------------------------------------------------------------
// Schema (subset — enough for Claude to produce typed output)
// ---------------------------------------------------------------------------

const DIAGNOSIS_SCHEMA = {
  type: "object",
  properties: {
    version: { type: "number", const: 1 },
    failureSetHash: { type: "string" },
    failures: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          file: { type: ["string", "null"] },
          title: { type: "string" },
          project: { type: "string" },
          category: { type: "string" },
          rootCauseKey: { type: "string" },
          actionable: { type: "boolean" },
          reason: { type: "string" },
        },
        required: [
          "id",
          "title",
          "project",
          "category",
          "rootCauseKey",
          "actionable",
          "reason",
        ],
      },
    },
    clusters: {
      type: "array",
      items: {
        type: "object",
        properties: {
          rootCauseKey: { type: "string" },
          failureIds: { type: "array", items: { type: "string" } },
          category: { type: "string" },
          actionable: { type: "boolean" },
          plannedFiles: { type: "array", items: { type: "string" } },
          diagnosis: { type: "string" },
          repairPlan: { type: "string" },
        },
        required: [
          "rootCauseKey",
          "failureIds",
          "category",
          "actionable",
          "plannedFiles",
          "diagnosis",
          "repairPlan",
        ],
      },
    },
    complete: { type: "boolean" },
  },
  required: ["version", "failureSetHash", "failures", "clusters", "complete"],
} as const;

// ---------------------------------------------------------------------------
// Node
// ---------------------------------------------------------------------------

/**
 * Dispatch a read-only diagnosis job to the repo-worker and classify the
 * aggregate outcome.
 */
export async function diagnoseFailures(
  deps: DiagnoseDeps,
): Promise<DiagnoseOutcome | null> {
  const basePrompt = await deps.fetchPrompt(DIAGNOSE_PROMPT_NAME);
  const prompt = [
    basePrompt,
    "",
    "## Frozen failure set",
    "",
    JSON.stringify(deps.failures, null, 2),
  ].join("\n");

  const client = deps.createClient(DIAGNOSE_DEADLINE_MS);

  const result = await client.run({
    ref: deps.stagingSha,
    commands: [],
    editableFiles: [],
    claude: {
      prompt,
      allowedTools: DIAGNOSE_ALLOWED_TOOLS,
      maxTurns: DIAGNOSE_MAX_TURNS,
      jsonSchema: DIAGNOSIS_SCHEMA,
    },
  });

  if (result.status !== "done" || !result.claude?.structuredOutput) {
    return null;
  }

  const diagnosis = result.claude.structuredOutput as DiagnosisResult;
  const aggregate = classifyAggregate(diagnosis);

  return { diagnosis, aggregate };
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

function classifyAggregate(
  diagnosis: DiagnosisResult,
): "noise" | "actionable" {
  const allEnvironment = diagnosis.failures.every(
    (f) => f.category === "env-flake",
  );
  return allEnvironment ? "noise" : "actionable";
}
