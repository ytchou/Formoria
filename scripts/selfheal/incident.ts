import { createHash } from "node:crypto";

export type FailureCategory =
  | "test-drift"
  | "seed-drift"
  | "app-regression"
  | "env-flake"
  | "flaky-suspect";

export interface SourceFailure {
  file: string | null;
  title: string;
  project: string;
}

export interface FrozenFailure extends SourceFailure {
  id: string;
}

export interface FrozenFailureSet {
  version: 1;
  failureSetHash: string;
  failures: FrozenFailure[];
}

export interface DiagnosisFailure extends FrozenFailure {
  category: FailureCategory;
  rootCauseKey: string;
  actionable: boolean;
  reason: string;
}

export interface DiagnosisCluster {
  rootCauseKey: string;
  failureIds: string[];
  category: string;
  actionable: boolean;
  plannedFiles: string[];
  diagnosis: string;
  repairPlan: string;
}

export interface DiagnosisResult {
  version: 1;
  failureSetHash: string;
  failures: DiagnosisFailure[];
  clusters: DiagnosisCluster[];
  complete: boolean;
}

export interface RepairResult {
  version: 1;
  failureSetHash: string;
  addressedFailureIds: string[];
  addressedRootCauseKeys: string[];
  changedFiles: string[];
  summary: string;
  remainingWork: string[];
  complete: boolean;
}

export interface IncidentCounters {
  repairCycle: number;
  infrastructureRetries: number;
  baseSyncAttempts: number;
}

export type IncidentTransition =
  "repair_cycle" | "infrastructure_retry" | "base_sync";

export interface MergeEligibility {
  eligible: boolean;
  reasons: string[];
}

export type TerminalOutcome =
  | "merged"
  | "review_ready"
  | "recovered_no_change"
  | "infrastructure_blocked"
  | "repair_blocked";

function canonicalFailure(failure: SourceFailure): SourceFailure {
  const title = failure.title.trim();
  const project = failure.project.trim();
  const file = failure.file?.trim() || null;
  if (!title || !project)
    throw new Error("Failure title and project are required");
  return { file, title, project };
}

function failureId(failure: SourceFailure): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalFailure(failure)))
    .digest("hex")
    .slice(0, 20);
}

function stableUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function equalSets(left: readonly string[], right: readonly string[]): boolean {
  return (
    JSON.stringify(stableUnique(left)) === JSON.stringify(stableUnique(right))
  );
}

function requireExactIds(
  expected: readonly string[],
  actual: readonly string[],
  label: string,
): void {
  const unique = new Set(actual);
  if (unique.size !== actual.length || !equalSets(expected, actual)) {
    throw new Error(`${label} must contain every frozen failure exactly once`);
  }
}

export function freezeFailures(
  failures: readonly SourceFailure[],
): FrozenFailureSet {
  if (failures.length === 0)
    throw new Error("Cannot freeze an empty failure set");
  const frozen = failures
    .map(canonicalFailure)
    .map((failure) => ({ ...failure, id: failureId(failure) }))
    .sort((left, right) => left.id.localeCompare(right.id));
  if (new Set(frozen.map(({ id }) => id)).size !== frozen.length) {
    throw new Error("Frozen failure set contains duplicate failures");
  }
  const failureSetHash = createHash("sha256")
    .update(JSON.stringify(frozen))
    .digest("hex");
  return { version: 1, failureSetHash, failures: frozen };
}

export function validateDiagnosis(
  frozen: FrozenFailureSet,
  result: DiagnosisResult,
): DiagnosisResult {
  if (result.version !== 1) throw new Error("Unsupported diagnosis version");
  if (result.failureSetHash !== frozen.failureSetHash) {
    throw new Error("Diagnosis failure-set hash does not match the frozen set");
  }
  if (!result.complete) throw new Error("Diagnosis must be complete");
  requireExactIds(
    frozen.failures.map(({ id }) => id),
    result.failures.map(({ id }) => id),
    "Diagnosis",
  );
  const frozenById = new Map(
    frozen.failures.map((failure) => [failure.id, failure]),
  );
  for (const failure of result.failures) {
    const source = frozenById.get(failure.id);
    if (
      !source ||
      source.file !== failure.file ||
      source.title !== failure.title ||
      source.project !== failure.project
    ) {
      throw new Error(`Diagnosis changed frozen failure ${failure.id}`);
    }
    if (!failure.rootCauseKey.trim() || !failure.reason.trim()) {
      throw new Error(`Diagnosis is missing evidence for ${failure.id}`);
    }
  }
  const clusterKeys = result.clusters.map(({ rootCauseKey }) => rootCauseKey);
  if (new Set(clusterKeys).size !== clusterKeys.length) {
    throw new Error("Diagnosis root-cause clusters must be unique");
  }
  const clusteredIds = result.clusters.flatMap(({ failureIds }) => failureIds);
  requireExactIds(
    frozen.failures.map(({ id }) => id),
    clusteredIds,
    "Diagnosis clusters",
  );
  const failureById = new Map(
    result.failures.map((failure) => [failure.id, failure]),
  );
  for (const cluster of result.clusters) {
    if (!cluster.diagnosis.trim() || !cluster.repairPlan.trim()) {
      throw new Error(
        `Cluster ${cluster.rootCauseKey} lacks diagnosis or repair plan`,
      );
    }
    for (const id of cluster.failureIds) {
      if (failureById.get(id)?.rootCauseKey !== cluster.rootCauseKey) {
        throw new Error(
          `Cluster ${cluster.rootCauseKey} contradicts failure ${id}`,
        );
      }
    }
  }
  return result;
}

export function validateRepair(
  diagnosis: DiagnosisResult,
  result: RepairResult,
  workingTreeFiles: readonly string[],
): RepairResult {
  if (result.version !== 1) throw new Error("Unsupported repair version");
  if (result.failureSetHash !== diagnosis.failureSetHash) {
    throw new Error("Diagnosis and repair failure-set hashes do not match");
  }
  if (!result.complete || result.remainingWork.length > 0) {
    throw new Error("Repair must be complete before exact-set verification");
  }
  const actionable = diagnosis.failures.filter(({ actionable }) => actionable);
  requireExactIds(
    actionable.map(({ id }) => id),
    result.addressedFailureIds,
    "Repair",
  );
  const actionableKeys = stableUnique(
    diagnosis.clusters
      .filter(({ actionable }) => actionable)
      .map(({ rootCauseKey }) => rootCauseKey),
  );
  if (!equalSets(actionableKeys, result.addressedRootCauseKeys)) {
    throw new Error(
      "Repair must address every actionable cluster exactly once",
    );
  }
  if (!equalSets(result.changedFiles, workingTreeFiles)) {
    throw new Error("Declared changed files do not match the working tree");
  }
  if (!result.summary.trim()) throw new Error("Repair summary is required");
  return result;
}

const infrastructurePatterns = [
  /connection (?:reset|timed? out)/i,
  /ECONNRESET|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT/i,
  /postgrest.*schema.?cache|schema.?cache.*(?:unavailable|loading)|PGRST002/i,
  /upstream connect error|disconnect\/reset before headers/i,
  /connection pool|PGRST003/i,
  /supabase.*(?:unavailable|timeout)/i,
  /data service.*unavailable/i,
  /widespread HTTP 500/i,
];

export function classifyInfrastructure(input: {
  errors: readonly string[];
  probe?: { authenticated: boolean; ok: boolean; status: number } | null;
}): { confirmed: boolean; reasons: string[] } {
  const signatureReasons = input.errors.filter((error) =>
    infrastructurePatterns.some((pattern) => pattern.test(error)),
  );
  const widespreadHttp500 =
    input.errors.filter((error) =>
      /\bHTTP\s*500\b|\bstatus(?: code)?[: ]+500\b/i.test(error),
    ).length >= 3;
  const probeFailed = input.probe?.authenticated === true && !input.probe.ok;
  const reasons = [
    ...signatureReasons.map((error) => `signature: ${error}`),
    ...(probeFailed
      ? [`authenticated Supabase probe failed (${input.probe?.status ?? 0})`]
      : []),
    ...(widespreadHttp500 ? ["widespread HTTP 500 responses"] : []),
  ];
  return {
    confirmed: probeFailed || signatureReasons.length > 0 || widespreadHttp500,
    reasons,
  };
}

export function nextIncidentState(
  current: IncidentCounters,
  transition: IncidentTransition,
): IncidentCounters {
  const next = { ...current };
  if (transition === "repair_cycle") {
    if (current.repairCycle >= 3)
      throw new Error("repair cycle limit reached (3)");
    next.repairCycle += 1;
  } else if (transition === "infrastructure_retry") {
    if (current.infrastructureRetries >= 2) {
      throw new Error("infrastructure retry limit reached (2)");
    }
    next.infrastructureRetries += 1;
  } else {
    if (current.baseSyncAttempts >= 2)
      throw new Error("base-sync limit reached (2)");
    next.baseSyncAttempts += 1;
  }
  return next;
}

export interface SelfMergeEvidence {
  diagnosis: DiagnosisResult;
  changedFiles: readonly string[];
  deletedOrRenamedSpecs: readonly string[];
  addedLines: readonly string[];
  testCountBefore: number;
  testCountAfter: number;
  assertionCountBefore: number;
  assertionCountAfter: number;
  skippedBefore: number;
  skippedAfter: number;
}

export function evaluateSelfMerge(input: SelfMergeEvidence): MergeEligibility {
  const reasons: string[] = [];
  const codeCategories = input.diagnosis.failures
    .filter(({ actionable }) => actionable)
    .map(({ category }) => category);
  if (
    codeCategories.some(
      (category) => category !== "test-drift" && category !== "seed-drift",
    )
  ) {
    reasons.push(
      "code-addressed findings are not exclusively test-drift or seed-drift",
    );
  }
  for (const path of input.changedFiles) {
    if (!/^e2e\/.+\.ts$/.test(path))
      reasons.push(`unsafe changed path: ${path}`);
  }
  if (input.deletedOrRenamedSpecs.length > 0) {
    reasons.push(
      `spec deleted or renamed: ${input.deletedOrRenamedSpecs.join(", ")}`,
    );
  }
  const forbidden = [
    { label: "test.skip", pattern: /\btest\.skip\s*\(/ },
    { label: "test.fixme", pattern: /\btest\.fixme\s*\(/ },
    { label: "test.only", pattern: /\btest\.only\s*\(/ },
    {
      label: "timeout increase",
      pattern: /\b(?:test\.)?setTimeout\s*\(|\btimeout\s*:/,
    },
    { label: "retry increase", pattern: /\bretr(?:y|ies)\s*[:(]/ },
  ];
  const additions = input.addedLines.join("\n");
  for (const rule of forbidden) {
    if (rule.pattern.test(additions))
      reasons.push(`forbidden test weakening: ${rule.label}`);
  }
  if (input.testCountAfter < input.testCountBefore)
    reasons.push("test count was reduced");
  if (input.assertionCountAfter < input.assertionCountBefore) {
    reasons.push("assertion count was reduced");
  }
  if (input.skippedAfter > input.skippedBefore)
    reasons.push("skipped-test count increased");
  return { eligible: reasons.length === 0, reasons: stableUnique(reasons) };
}

export interface IncidentPrBodyInput {
  rootIncidentId: string;
  rootWorkflowUrl: string;
  currentWorkflowUrl: string;
  frozen: FrozenFailureSet;
  diagnosis?: DiagnosisResult;
  cycles: Array<{ cycle: number; commit: string; changedFiles: string[] }>;
  exactValidation: string;
  fullValidation: string;
  infrastructureRetries: number;
  remainingFailures: SourceFailure[];
  mergeEligibility: MergeEligibility;
  terminalOutcome?: TerminalOutcome;
}

export function renderIncidentPrBody(input: IncidentPrBodyInput): string {
  const failureLines = input.frozen.failures.map(
    (failure) =>
      `- \`${failure.id}\` ${failure.project}: ${failure.file ?? "workflow"} — ${failure.title}`,
  );
  const clusterLines = (input.diagnosis?.clusters ?? []).map(
    (cluster) =>
      `- **${cluster.rootCauseKey}** (${cluster.category}, ${cluster.actionable ? "actionable" : "observe"}): ${cluster.diagnosis}`,
  );
  const cycleLines = input.cycles.map(
    (cycle) =>
      `- Cycle ${cycle.cycle}: \`${cycle.commit}\` — ${cycle.changedFiles.map((path) => `\`${path}\``).join(", ")}`,
  );
  const remainingLines = input.remainingFailures.map(
    (failure) =>
      `- ${failure.project}: ${failure.file ?? "workflow"} — ${failure.title}`,
  );
  return [
    "<!-- formoria-e2e-selfheal-incident -->",
    "# E2E self-heal incident",
    "",
    `- Root incident: \`${input.rootIncidentId}\` ([workflow](${input.rootWorkflowUrl}))`,
    `- Current workflow: [run](${input.currentWorkflowUrl})`,
    `- Failure-set hash: \`${input.frozen.failureSetHash}\``,
    `- Infrastructure retries: ${input.infrastructureRetries}/2`,
    `- Exact-set validation: **${input.exactValidation}**`,
    `- Full deep/mobile validation: **${input.fullValidation}**`,
    `- Auto-merge eligible: **${input.mergeEligibility.eligible ? "yes" : "no"}**`,
    ...(input.terminalOutcome
      ? [`- Terminal outcome: \`${input.terminalOutcome}\``]
      : []),
    "",
    "## Original failure set",
    "",
    ...failureLines,
    "",
    "## Diagnosis clusters",
    "",
    ...(clusterLines.length > 0 ? clusterLines : ["- Diagnosis pending"]),
    "",
    "## Repair cycles",
    "",
    ...(cycleLines.length > 0 ? cycleLines : ["- No code checkpoint"]),
    "",
    "## Remaining failures",
    "",
    ...(remainingLines.length > 0 ? remainingLines : ["- None"]),
    "",
    "## Merge policy",
    "",
    ...(input.mergeEligibility.reasons.length > 0
      ? input.mergeEligibility.reasons.map(
          (reason) => `- Disqualified: ${reason}`,
        )
      : ["- All test-only eligibility checks passed."]),
    "",
    "This body is workflow-owned and is replaced as incident evidence changes.",
  ].join("\n");
}

export function terminalOutcome(input: {
  merged?: boolean;
  reviewReady?: boolean;
  recoveredNoChange?: boolean;
  infrastructureBlocked?: boolean;
}): TerminalOutcome {
  if (input.merged) return "merged";
  if (input.reviewReady) return "review_ready";
  if (input.recoveredNoChange) return "recovered_no_change";
  if (input.infrastructureBlocked) return "infrastructure_blocked";
  return "repair_blocked";
}
