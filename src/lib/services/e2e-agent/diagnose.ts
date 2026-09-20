/**
 * Diagnose node — dispatch read-only analysis to repo-worker.
 *
 * Sends the frozen failure set to a read-only agent session inside a fresh clone.
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
const DIAGNOSE_PROMPT_NAME = "e2e-nightly-diagnose";

const DIAGNOSE_FALLBACK_PROMPT = `You are diagnosing e2e test failures for the Formoria web application.

For each failure, classify it as one of:
- env-flake: environment/infra issue (network, timeout, CF Access, rate limit)
- test-drift: test code is stale vs the current UI (selectors, text, routes changed)
- app-regression: a real product bug introduced by recent code changes
- seed-drift: test relies on seed data that has changed
- flaky-suspect: non-deterministic failure, likely timing or race condition

Return a JSON object matching the provided schema.`;

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
// Schema
// ---------------------------------------------------------------------------

const DIAGNOSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    version: { type: "number", const: 1 },
    failureSetHash: { type: "string" },
    failures: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          file: { type: ["string", "null"] },
          title: { type: "string" },
          project: { type: "string" },
          category: {
            type: "string",
            enum: [
              "test-drift",
              "seed-drift",
              "app-regression",
              "env-flake",
              "flaky-suspect",
            ],
          },
          rootCauseKey: { type: "string" },
          actionable: { type: "boolean" },
          reason: { type: "string" },
        },
        required: [
          "id",
          "file",
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
        additionalProperties: false,
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
  let basePrompt: string;
  try {
    basePrompt = await deps.fetchPrompt(DIAGNOSE_PROMPT_NAME);
  } catch {
    console.log(
      `[e2e-diagnose] prompt "${DIAGNOSE_PROMPT_NAME}" not found, using inline fallback`,
    );
    basePrompt = DIAGNOSE_FALLBACK_PROMPT;
  }
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
    agent: {
      prompt,
      access: "read",
      jsonSchema: DIAGNOSIS_SCHEMA,
    },
  });

  if (result.status !== "done" || !result.agent?.structuredOutput) {
    return null;
  }

  const diagnosis = result.agent.structuredOutput as DiagnosisResult;
  const aggregate = classifyAggregate(diagnosis);

  return { diagnosis, aggregate };
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

function classifyAggregate(diagnosis: DiagnosisResult): "noise" | "actionable" {
  const allEnvironment =
    diagnosis.failures.length > 0 &&
    diagnosis.failures.every((f) => f.category === "env-flake");
  return allEnvironment ? "noise" : "actionable";
}
